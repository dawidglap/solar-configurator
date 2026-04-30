"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import AddressSearchOSM from "../geocoding/AddressSearchOSM";
import {
  buildTiledSnapshot,
  TILE_SWISSTOPO_SAT,
} from "../utils/stitchTilesWMTS";
import {
  metersPerPixel3857,
  lonLatTo3857,
  bboxLonLatFromCenter,
} from "../utils/geo";
import axios from "axios";
import { history as plannerHistory } from "../state/history";
import { savePlannerToDb } from "../state/planning/savePlanning";

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildAddressFromParams(sp: ReturnType<typeof useSearchParams>) {
  const full = sp.get("address")?.trim();
  if (full) return full;

  const street = sp.get("addressStreet")?.trim() ?? "";
  const zip = sp.get("addressZip")?.trim() ?? "";
  const city = sp.get("addressCity")?.trim() ?? "";
  const country = sp.get("addressCountry")?.trim() ?? "";
  const locality = [zip, city].filter(Boolean).join(" ");

  const built = [street, locality, country].filter(Boolean).join(", ").trim();
  return built || null;
}

async function geocodeFirstAddress(query: string) {
  const url =
    `https://api3.geo.admin.ch/rest/services/api/SearchServer` +
    `?type=locations&searchText=${encodeURIComponent(query)}` +
    `&lang=de&sr=4326&limit=12`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Address lookup failed (${res.status})`);
  }

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];

  for (const item of results) {
    const attrs = item?.attrs ?? {};
    const label = stripHtml(attrs.label || attrs.detail || item.label || query);
    const lat = Number(attrs.lat ?? item.y);
    const lon = Number(attrs.lon ?? item.x);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { label, lat, lon };
    }
  }

  return null;
}

/** proietta (lat,lon) → px immagine usando la bbox3857 dello snapshot */
function latLonToPx(
  lat: number,
  lon: number,
  snap: {
    width: number;
    height: number;
    bbox3857: { minX: number; minY: number; maxX: number; maxY: number };
  },
) {
  const { x, y } = lonLatTo3857(lon, lat);
  const { minX, minY, maxX, maxY } = snap.bbox3857;
  const W = snap.width,
    H = snap.height;
  const px = ((x - minX) / (maxX - minX)) * W;
  const py = ((maxY - y) / (minY - maxY)) * H * -1;
  return { x: px, y: py };
}

/** v1-style: prendi SOLO le falde “sotto il punto” dall’endpoint identify */
async function fetchRoofsAtPointToPx(
  lat: number,
  lon: number,
  snap: {
    width: number;
    height: number;
    bbox3857: { minX: number; minY: number; maxX: number; maxY: number };
  },
) {
  const { data } = await axios.get(
    "https://api3.geo.admin.ch/rest/services/energie/MapServer/identify",
    {
      params: {
        geometryType: "esriGeometryPoint",
        geometry: `${lon},${lat}`,
        sr: 4326,
        layers: "all:ch.bfe.solarenergie-eignung-daecher",
        tolerance: 10,
        mapExtent: `${lon - 0.002},${lat - 0.002},${lon + 0.002},${lat + 0.002}`,
        imageDisplay: "600,400,96",
        lang: "de",
      },
    },
  );

  const results: any[] = data?.results ?? [];
  const roofs: {
    id: string;
    pointsPx: { x: number; y: number }[];
    tiltDeg?: number;
    azimuthDeg?: number;
  }[] = [];

  results.forEach((res, resIdx) => {
    const rings: number[][][] | undefined = res?.geometry?.rings;
    const attrs: any = res?.attributes ?? {};
    if (!Array.isArray(rings)) return;

    rings.forEach((ring, ringIdx) => {
      const pts = ring.map(([lng2, lat2]) => latLonToPx(lat2, lng2, snap));
      const id =
        attrs?.id != null
          ? String(attrs.id)
          : `roof-${res?.layerId ?? "layer"}-${res?.featureId ?? "feat"}-${resIdx}-${ringIdx}`;

      roofs.push({
        id,
        pointsPx: pts,
        tiltDeg: typeof attrs?.neigung === "number" ? attrs.neigung : undefined,
        azimuthDeg:
          typeof attrs?.ausrichtung === "number"
            ? attrs.ausrichtung
            : undefined,
      });
    });
  });

  return roofs;
}

export default function TopbarAddressSearch() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId");
  const requestedAddress = useMemo(() => buildAddressFromParams(sp), [sp]);
  const shouldAutoSearch = sp.get("autosearch") === "1";

  const resetForNewAddress = usePlannerV2Store((s) => s.resetForNewAddress);
  const setUI = usePlannerV2Store((s) => s.setUI);
  const addRoof = usePlannerV2Store((s) => s.addRoof);
  const setStep = usePlannerV2Store((s) => s.setStep);

  // persistenza address
  const address = usePlannerV2Store((s) => s.address);
  const setAddress = usePlannerV2Store((s) => s.setAddress);
  const snapshot = usePlannerV2Store((s) => s.snapshot);
  const hydrationReady = usePlannerV2Store((s) => s.hydrationReady);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoSearchTriggeredRef = useRef(false);

  // testo visibile nella searchbar
  const [addressText, setAddressText] = useState<string>(
    () => address?.label ?? "",
  );

  useEffect(() => {
    setAddressText(address?.label ?? "");
  }, [address?.label]);

  const startFromAddress = useCallback(
    async (lat: number, lon: number, label: string) => {
      setErr(null);
      setLoading(true);

      try {
        const ZOOM = 20;
        const {
          dataUrl,
          width: w,
          height: h,
        } = await buildTiledSnapshot({
          lat,
          lon,
          zoom: ZOOM,
          width: 2800,
          height: 1800,
          scale: 1,
          tileUrl: TILE_SWISSTOPO_SAT,
          attribution: "© swisstopo",
        });

        const { minLon, minLat, maxLon, maxLat } = bboxLonLatFromCenter(
          { lon, lat },
          ZOOM,
          w,
          h,
        );
        const bl = lonLatTo3857(minLon, minLat),
          tr = lonLatTo3857(maxLon, maxLat);

        const snapObj = {
          url: dataUrl,
          width: w,
          height: h,
          mppImage: metersPerPixel3857(lat, ZOOM),
          center: { lat, lon },
          zoom: ZOOM,
          address: label,
          bbox3857: { minX: bl.x, minY: bl.y, maxX: tr.x, maxY: tr.y },
        } as const;

        resetForNewAddress(snapObj);
        setStep("building");

        plannerHistory.push("before import roofs");

        const roofs = await fetchRoofsAtPointToPx(lat, lon, snapObj);

        roofs.forEach((p, i) => {
          addRoof({
            id: `sd_${p.id}_${i}`,
            name: `Roof ${i + 1}`,
            points: p.pointsPx,
            tiltDeg: p.tiltDeg,
            azimuthDeg: p.azimuthDeg,
            source: "sonnendach",
          } as any);
        });

        setUI({ rightPanelOpen: true });

        if (planningId) {
          await savePlannerToDb(planningId);
        } else {
          console.warn(
            "No planningId found in URL, planner state not saved to DB.",
          );
        }
      } catch (e: any) {
        setErr(e?.message ?? "Unbekannter Fehler.");
      } finally {
        setLoading(false);
      }
    },
    [addRoof, planningId, resetForNewAddress, setStep, setUI],
  );

  useEffect(() => {
    if (!requestedAddress) return;
    if (address.label) return;

    setAddress({
      label: requestedAddress,
      lat: address.lat ?? null,
      lon: address.lon ?? null,
    });
  }, [address.label, address.lat, address.lon, requestedAddress, setAddress]);

  useEffect(() => {
    if (!hydrationReady) return;
    if (!shouldAutoSearch || !requestedAddress) return;
    if (autoSearchTriggeredRef.current) return;
    if (loading) return;

    const hasExistingMap =
      Boolean(snapshot?.url) ||
      (typeof snapshot?.center?.lat === "number" &&
        typeof snapshot?.center?.lon === "number");

    if (hasExistingMap) return;

    autoSearchTriggeredRef.current = true;
    setErr(null);
    setAddress({ label: requestedAddress, lat: null, lon: null });
    setAddressText(requestedAddress);

    void (async () => {
      try {
        const result = await geocodeFirstAddress(requestedAddress);
        if (!result) {
          setErr("Adresse konnte nicht automatisch gefunden werden.");
          return;
        }

        setAddress({ label: result.label, lat: result.lat, lon: result.lon });
        setAddressText(result.label);
        await startFromAddress(result.lat, result.lon, result.label);
      } catch (e: any) {
        setErr(
          e?.message ?? "Automatische Adresssuche konnte nicht gestartet werden.",
        );
      }
    })();
  }, [
    hydrationReady,
    loading,
    requestedAddress,
    setAddress,
    shouldAutoSearch,
    snapshot?.center?.lat,
    snapshot?.center?.lon,
    snapshot?.url,
    startFromAddress,
  ]);

  return (
    <>
      <div
        className={`
          planner-topbar
          relative z-[1000000]
          flex min-w-[260px] max-w-[260px] items-center gap-2
          h-9 rounded-lg border border-border bg-secondary/40 pl-2 pr-2 text-foreground
          focus-within:ring-1 focus-within:ring-primary/30
          overflow-visible text-xs
        `}
        aria-busy={loading ? "true" : "false"}
      >
        <Search className="h-3 w-3 text-muted-foreground shrink-0" />

        <div className="relative flex-1">
          {loading && (
            <div className="absolute inset-0 z-10 cursor-wait rounded-full bg-transparent" />
          )}
          <div className="[&_input]:h-7 [&_input]:w-full [&_input]:bg-transparent [&_input]:border-0 [&_input]:outline-none [&_input]:text-sm [&_input]:text-foreground [&_input]:placeholder:text-muted-foreground">
            <AddressSearchOSM
              placeholder="Adresse suchen…"
              value={addressText}
              onChangeText={(v: string) => setAddressText(v)}
              onPick={(r: any) => {
                const label =
                  r?.label ?? r?.display_name ?? addressText ?? "Adresse";

                setAddress?.({ label, lat: r.lat, lon: r.lon });
                setAddressText(label);

                startFromAddress(r.lat, r.lon, label);
              }}
            />
          </div>
        </div>

        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {!!err && <span className="ml-1 text-[10px] text-destructive">{err}</span>}
      </div>

      <style>{`
        .planner-topbar .react-autosuggest__suggestions-container,
        .planner-topbar .react-autosuggest__suggestions-container--open,
        .planner-topbar .react-select__menu,
        .planner-topbar .react-autocomplete,
        .planner-topbar .osm-dropdown,
        .planner-topbar .osm-suggestions,
        .planner-topbar [role="listbox"],
        .planner-topbar .pac-container,
        .planner-topbar .leaflet-control-geocoder .results {
          position: relative !important;
          z-index: 1000000 !important;
        }
      `}</style>
    </>
  );
}
