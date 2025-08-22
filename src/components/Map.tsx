"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  useMapEvents,
  Polygon as RLPolygon,
  Rectangle,
  CircleMarker,
} from "react-leaflet";

import AssignMapRef from "./MapComplete/AssignMapRef";
import type { RoofPolygon, RoofAttributes } from "@/types/roof";

import AddressSearch from "./AddressSearch";
import axios from "axios";
import ZoomControls from "./ZoomControls";
import L from "leaflet";
import PlannerSidebar from "./PlannerSidebar";
import Footbar from "./Footbar";
import RoofPolygonsRenderer from "./MapComplete/RoofPolygonsRenderer";
import SolarModulesPlacer from "./SolarModulesPlacer";

// --- piccolo helper UI (floating action button)
function Fab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-6 bottom-24 z-[1000] px-3 py-2 rounded-full shadow-lg border
        ${active ? "bg-red-600 text-white border-red-700" : "bg-white/80 text-black border-black/10"}
        backdrop-blur hover:bg-white`}
      title="Disegna zona esclusa (2 click)"
    >
      {active ? "🛑 Zeichnen beenden" : "🚫 Ausschluss zeichnen"}
    </button>
  );
}

// opzionale: tieni traccia del modulo usato nell’MVP
const DEFAULT_MODULE_SIZE: [number, number] = [1.722, 1.134]; // 400 W portrait

function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportBtn({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`fixed top-6 right-6 z-[1000] px-3 py-2 rounded-full shadow-lg border backdrop-blur
        ${disabled
          ? "bg-white/60 text-black/40 border-black/10 cursor-not-allowed"
          : "bg-white/80 text-black border-black/10 hover:bg-white"}`}
      title="Esporta layout in JSON"
    >
      ⬇️ Export JSON
    </button>
  );
}

// --- cattura 2 click e produce un rettangolo [lat,lng][]; solo quando active=true
function ExclusionDrawer({
  active,
  allowedArea,
  onRectDone,
}: {
  active: boolean;
  allowedArea?: [number, number][];
  onRectDone: (poly: [number, number][]) => void;
}) {
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);

  // ray-casting in lat/lng
  const pointInPolyLatLng = (pt: [number, number], poly?: [number, number][]) => {
    if (!poly || poly.length < 3) return true;
    const [lat, lng] = pt;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [lati, lngi] = poly[i];
      const [latj, lngj] = poly[j];
      const intersect =
        (lngi > lng) !== (lngj > lng) &&
        lat < ((latj - lati) * (lng - lngi)) / (lngj - lngi) + lati;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  useMapEvents({
    click(e) {
      if (!active) return;
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];

      // Primo click: set anchor solo se dentro falda
      if (!anchor) {
        if (!pointInPolyLatLng(pt, allowedArea)) return;
        setAnchor(pt);
        setHover(pt);
        return;
      }

      // Secondo click: prova a chiudere
      const [aLat, aLng] = anchor;
      const [bLat, bLng] = pt;
      const minLat = Math.min(aLat, bLat);
      const maxLat = Math.max(aLat, bLat);
      const minLng = Math.min(aLng, bLng);
      const maxLng = Math.max(aLng, bLng);
      const rect: [number, number][] = [
        [minLat, minLng],
        [minLat, maxLng],
        [maxLat, maxLng],
        [maxLat, minLng],
        [minLat, minLng],
      ];

      const cornersInside = rect.slice(0, 4).every((c) => pointInPolyLatLng(c, allowedArea));
      if (cornersInside) onRectDone(rect);

      // reset stato disegno, comunque
      setAnchor(null);
      setHover(null);
    },

    mousemove(e) {
      if (!active || !anchor) return;
      setHover([e.latlng.lat, e.latlng.lng]);
    },

    keydown(e: any) {
      if (!active) return;
      if (e.originalEvent?.key === "Escape") {
        setAnchor(null);
        setHover(null);
      }
    },
  });

  // Preview live del rettangolo + puntino di ancoraggio
  let previewBounds: [[number, number], [number, number]] | null = null;
  let previewValid = true;

  if (anchor && hover) {
    const minLat = Math.min(anchor[0], hover[0]);
    const maxLat = Math.max(anchor[0], hover[0]);
    const minLng = Math.min(anchor[1], hover[1]);
    const maxLng = Math.max(anchor[1], hover[1]);
    previewBounds = [
      [minLat, minLng],
      [maxLat, maxLng],
    ];

    const rectCorners: [number, number][] = [
      [minLat, minLng],
      [minLat, maxLng],
      [maxLat, maxLng],
      [maxLat, minLng],
    ];
    previewValid = rectCorners.every((c) => pointInPolyLatLng(c, allowedArea));
  }

  return (
    <>
      {anchor && (
        <CircleMarker
          center={anchor}
          radius={4}
          pathOptions={{
            color: "#22d3ee",
            weight: 2,
            fillColor: "#22d3ee",
            fillOpacity: 1,
          }}
        />
      )}

      {previewBounds && (
        <Rectangle
          bounds={previewBounds}
          pathOptions={{
            color: previewValid ? "#22c55e" : "#ef4444",
            weight: 2,
            dashArray: "4 4",
            fillColor: previewValid ? "#22c55e" : "#ef4444",
            fillOpacity: 0.15,
          }}
        />
      )}
    </>
  );
}

function UndoBtn({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`fixed right-6 bottom-36 z-[1000] px-3 py-2 rounded-full shadow-lg border backdrop-blur
        ${disabled
          ? "bg-white/60 text-black/40 border-black/10 cursor-not-allowed"
          : "bg-white/80 text-black border-black/10 hover:bg-white"}`}
      title="Annulla ultima zona esclusa"
    >
      Letzten Ausschluss rückgängig
    </button>
  );
}

function ClearBtn({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`fixed right-6 bottom-48 z-[1000] px-3 py-2 rounded-full shadow-lg border backdrop-blur
        ${disabled
          ? "bg-white/60 text-black/40 border-black/10 cursor-not-allowed"
          : "bg-white/80 text-black border-black/10 hover:bg-white"}`}
      title="Rimuovi tutte le zone escluse"
    >
      Alle Ausschlüsse löschen
    </button>
  );
}


export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofAreas, setSelectedRoofAreas] = useState<RoofAttributes[]>([]);
  // in cima ai tuoi state


  const [planningParams, setPlanningParams] = useState({
    targetKwp: 8.8,
    margin: 0.3,
    spacing: 0.02,
    orientation: "portrait" as "portrait" | "landscape",
    excludePoor: false,
  });

  // esclusioni e modalità disegno
  const [exclusions, setExclusions] = useState<[number, number][][]>([]);
  const [drawExclude, setDrawExclude] = useState(false);

  // Stats dai moduli
  const [moduleStats, setModuleStats] = useState<{ count: number; areaPlan: number }>({
    count: 0,
    areaPlan: 0,
  });

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[MAP][STATS from placer]", moduleStats);
  }, [moduleStats.count, moduleStats.areaPlan]);

  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !selectedPosition) return;
    const map = mapRef.current;
    const currentCenter = map.getCenter();
    const dx = Math.abs(currentCenter.lat - selectedPosition.lat);
    const dy = Math.abs(currentCenter.lng - selectedPosition.lon);
    const distanceThreshold = 0.001; // ≈ 100 m
    const isFarEnough = dx > distanceThreshold || dy > distanceThreshold;
    if (isFarEnough) map.flyTo([selectedPosition.lat, selectedPosition.lon], 20, { duration: 2 });
  }, [selectedPosition]);

  const idlePanIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedPosition || !mapRef.current) return;
    if (idlePanIntervalRef.current) return;

    let frame = 0;
    const MAX_STEPS = 6;
    idlePanIntervalRef.current = window.setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      const lat = center.lat + Math.sin(frame / 200) * 0.0001;
      const lng = center.lng + 0.00015;
      map.setView([lat, lng], map.getZoom(), { animate: false });
      frame++;
      if (frame >= MAX_STEPS) {
        window.clearInterval(idlePanIntervalRef.current!);
        idlePanIntervalRef.current = null;
      }
    }, 5000);

    return () => {
      if (idlePanIntervalRef.current) {
        window.clearInterval(idlePanIntervalRef.current);
        idlePanIntervalRef.current = null;
      }
    };
  }, [selectedPosition]);

  const handleSelectLocation = async (lat: number, lon: number) => {
    if (!selectedPosition) setSelectedPosition({ lat, lon });

    try {
      const identifyResponse = await axios.get(
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
        }
      );

      const results = identifyResponse.data?.results ?? [];
      if (results.length === 0) {
        setRoofPolygons([]);
        return;
      }

      const polygons: RoofPolygon[] = [];
      results.forEach((res: any) => {
        const rings = res.geometry?.rings;
        const eignung = res.attributes?.dach_eignung;
        if (rings && Array.isArray(rings)) {
          rings.forEach((ring: number[][]) => {
            const converted = ring.map(([lng2, lat2]) => [lat2, lng2]);
            polygons.push({ coords: converted, eignung, attributes: res.attributes });
          });
        }
      });

      setRoofPolygons(polygons);
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error("❌ Errore:", error?.message || error);
    }
  };

  // individua la falda selezionata tramite la chiave __polyKey
  const selectedKey = (selectedRoofAreas[0] as any)?.__polyKey as string | undefined;

  const selectedPolygon: RoofPolygon | undefined = useMemo(() => {
    if (!selectedKey) return undefined;
    return roofPolygons.find((p, i) => `${p.attributes.id}::${i}` === selectedKey);
  }, [roofPolygons, selectedKey]);

  // Callback stabile per stats
  const handleStats = useCallback((stats: { count: number; areaPlan: number }) => {
    setModuleStats((prev) =>
      prev.count === stats.count && prev.areaPlan === stats.areaPlan ? prev : stats
    );
  }, []);

  // reset esclusioni se cambi falda
  useEffect(() => {
    setExclusions([]);
  }, [selectedKey]);

  // >>> QUI: callback EXPORT spostata DENTRO il componente (prima era fuori e rompeva)
  const handleExportJSON = useCallback(() => {
    if (!selectedPolygon) return;

    const roofAttrs = (selectedRoofAreas[0] as any) ?? {};
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        app: "planung-mvp",
        version: "0.1",
      },
      map: {
        selectedPosition,
        tileLayer:
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
      },
      planningParams: {
        ...planningParams,
      },
      selection: {
        roofId: roofAttrs.id ?? null,
        attributes: roofAttrs,
        polygonCoords: selectedPolygon.coords, // lat,lng[]
      },
      panels: {
        count: moduleStats.count,
        planAreaM2: Number(moduleStats.areaPlan?.toFixed(2) ?? 0),
        moduleSizeMeters: DEFAULT_MODULE_SIZE,
        orientation: planningParams.orientation,
        marginMeters: planningParams.margin,
        spacingMeters: planningParams.spacing,
      },
      exclusions, // Array di poligoni [lat,lng][]
    };

    const fname = `planung_export_${roofAttrs.id ?? "roof"}_${Date.now()}.json`;
    downloadJSON(fname, payload);
  }, [
    selectedPolygon,
    selectedRoofAreas,
    planningParams,
    moduleStats,
    exclusions,
    selectedPosition,
  ]);

  return (
    <div className="relative h-screen w-screen">
      <PlannerSidebar
        visible={!!selectedPosition}
        params={planningParams}
        onChangeParams={setPlanningParams}
      />

      {/* FAB per disegnare zona esclusa */}
      <Fab active={drawExclude} onClick={() => setDrawExclude((v) => !v)} />

        <UndoBtn
  disabled={exclusions.length === 0}
  onClick={() => setExclusions(prev => prev.slice(0, -1))}
/>

<ClearBtn
  disabled={exclusions.length === 0}
  onClick={() => setExclusions([])}
/>


      {/* Export JSON */}
      <ExportBtn disabled={!selectedPolygon} onClick={handleExportJSON} />

      <div className="absolute inset-0 z-0">
        <MapContainer
          key="main-map"
          center={[47.3769, 8.5417]}
          zoom={13}
          scrollWheelZoom
          zoomControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <AssignMapRef mapRef={mapRef} />

          <TileLayer
            attribution="© swisstopo"
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
            maxZoom={20}
          />

          <ZoomControls />

          <RoofPolygonsRenderer
            roofPolygons={roofPolygons}
            selectedRoofAreas={selectedRoofAreas}
            setSelectedRoofAreas={setSelectedRoofAreas}
            excludePoor={planningParams.excludePoor} 
          />

          {/* Disegno rettangolo di esclusione quando attivo */}
          <ExclusionDrawer
            active={drawExclude}
            allowedArea={selectedPolygon?.coords as [number, number][]}
            onRectDone={(poly) => {
              setExclusions((prev) => [...prev, poly]);
              setDrawExclude(false);
            }}
          />

          {/* Visualizza poligoni di esclusione (rosso) */}
    {exclusions.map((poly, i) => (
  <RLPolygon
    key={`ex-${i}`}
    positions={poly as [number, number][]}
    pathOptions={{
      color: "rgba(220, 38, 38, 1)",
      weight: 1,
      fillColor: "rgba(220, 38, 38, 0.35)",
      fillOpacity: 0.7,
    }}
    eventHandlers={{
      click: () => setExclusions(prev => prev.filter((_, j) => j !== i)),
      mouseover: (e) => e.target.setStyle({ weight: 2, fillOpacity: 0.5 }),
      mouseout:  (e) => e.target.setStyle({ weight: 1, fillOpacity: 0.7 }),
    }}
  />
))}


          {/* layer pannelli sulla falda attiva */}
          {selectedPolygon && (
            <SolarModulesPlacer
              polygonCoords={selectedPolygon.coords as [number, number][]}
              ausrichtung={(selectedRoofAreas[0] as any)?.ausrichtung}
              neigung={(selectedRoofAreas[0] as any)?.neigung}
              marginMeters={planningParams.margin}
              spacingMeters={planningParams.spacing}
              orientation={planningParams.orientation}
              exclusions={exclusions}
              fillMode
              visible
              onStats={handleStats}
            />
          )}
        </MapContainer>
      </div>

      <div
        className="fixed top-16 z-50"
        style={{ left: "calc(50% - 8rem)", transform: "translateX(-50%)" }}
      >
        <AddressSearch onSelectLocation={handleSelectLocation} />
      </div>

      {selectedRoofAreas.length > 0 && (
        <Footbar data={selectedRoofAreas} modsStats={moduleStats} />
      )}
    </div>
  );
}
