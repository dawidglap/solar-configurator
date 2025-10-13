'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';
import { metersPerPixel3857, lonLatTo3857, bboxLonLatFromCenter } from '../utils/geo';
import axios from 'axios';
import { history as plannerHistory } from '../state/history';

/** proietta (lat,lon) → px immagine usando la bbox3857 dello snapshot */
function latLonToPx(
  lat: number,
  lon: number,
  snap: { width: number; height: number; bbox3857: { minX: number; minY: number; maxX: number; maxY: number } }
) {
  const { x, y } = lonLatTo3857(lon, lat);
  const { minX, minY, maxX, maxY } = snap.bbox3857;
  const W = snap.width, H = snap.height;
  const px = ((x - minX) / (maxX - minX)) * W;
  const py = ((maxY - y) / (minY - maxY)) * H * -1; // equivalente a ((maxY - y)/(maxY - minY))*H
  return { x: px, y: py };
}

/** v1-style: prendi SOLO le falde “sotto il punto” dall’endpoint identify */
async function fetchRoofsAtPointToPx(
  lat: number,
  lon: number,
  snap: { width: number; height: number; bbox3857: { minX: number; minY: number; maxX: number; maxY: number } }
) {
  const { data } = await axios.get(
    'https://api3.geo.admin.ch/rest/services/energie/MapServer/identify',
    {
      params: {
        geometryType: 'esriGeometryPoint',
        geometry: `${lon},${lat}`,
        sr: 4326,
        layers: 'all:ch.bfe.solarenergie-eignung-daecher',
        tolerance: 10,
        mapExtent: `${lon - 0.002},${lat - 0.002},${lon + 0.002},${lat + 0.002}`,
        imageDisplay: '600,400,96',
        lang: 'de',
      },
    }
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
          : `roof-${res?.layerId ?? 'layer'}-${res?.featureId ?? 'feat'}-${resIdx}-${ringIdx}`;

      roofs.push({
        id,
        pointsPx: pts,
        tiltDeg: typeof attrs?.neigung === 'number' ? attrs.neigung : undefined,
        azimuthDeg: typeof attrs?.ausrichtung === 'number' ? attrs.ausrichtung : undefined,
      });
    });
  });

  return roofs;
}

export default function TopbarAddressSearch() {
  const resetForNewAddress = usePlannerV2Store(s => s.resetForNewAddress);
  const setUI              = usePlannerV2Store(s => s.setUI);
  const addRoof            = usePlannerV2Store(s => s.addRoof);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startFromAddress = async (lat: number, lon: number) => {
    setErr(null); setLoading(true);
    try {
      const ZOOM = 20;
      const { dataUrl, width: w, height: h } = await buildTiledSnapshot({
        lat, lon, zoom: ZOOM, width: 2800, height: 1800, scale: 1,
        tileUrl: TILE_SWISSTOPO_SAT, attribution: '© swisstopo'
      });

      const { minLon, minLat, maxLon, maxLat } = bboxLonLatFromCenter({ lon, lat }, ZOOM, w, h);
      const bl = lonLatTo3857(minLon, minLat), tr = lonLatTo3857(maxLon, maxLat);

      const snapObj = {
        url: dataUrl, width: w, height: h,
        mppImage: metersPerPixel3857(lat, ZOOM),
        center: { lat, lon }, zoom: ZOOM,
        bbox3857: { minX: bl.x, minY: bl.y, maxX: tr.x, maxY: tr.y },
      } as const;

      // 1) reset totale progetto + snapshot nuovo (svuota layers/zones/panels, selezioni e history)
      resetForNewAddress(snapObj);

      // 2) crea un checkpoint per consentire UNDO dell'import massivo
      plannerHistory.push('before import roofs');

      // 3) importa solo le falde “sotto il punto”
      const roofs = await fetchRoofsAtPointToPx(lat, lon, snapObj);
      roofs.forEach((p, i) => {
        addRoof({
          id:         `sd_${p.id}_${i}`,
          name:       `Roof ${i + 1}`,
          points:     p.pointsPx,
          tiltDeg:    p.tiltDeg,
          azimuthDeg: p.azimuthDeg,
          source:     'sonnendach',
        } as any);
      });

      // 4) pannello proprietà visibile
      setUI({ rightPanelOpen: true });

    } catch (e: any) {
      setErr(e?.message ?? 'Unbekannter Fehler.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* wrapper con classe "planner-topbar" per forzare z-index dei menu suggerimenti */}
      <div
        className={`
          planner-topbar
          relative z-[1000000]
          flex min-w-[348px] max-w-[64vw] items-center gap-2
          h-9 rounded-full border border-neutral-300 bg-white pl-2 pr-2
          focus-within:ring-1 focus-within:ring-neutral-400
          overflow-visible
        `}
        aria-busy={loading ? 'true' : 'false'}
      >
        <Search className="h-4 w-4 text-neutral-500 shrink-0" />

        <div className="relative flex-1">
          {loading && <div className="absolute inset-0 z-10 cursor-wait rounded-full bg-transparent" />}
          <div className="[&_input]:h-7 [&_input]:w-full [&_input]:bg-transparent [&_input]:border-0 [&_input]:outline-none [&_input]:text-sm [&_input]:placeholder:text-neutral-400">
            <AddressSearchOSM
              placeholder="Adresse suchen…"
              onPick={(r) => startFromAddress(r.lat, r.lon)}
            />
          </div>
        </div>

        {loading && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
        {!!err && <span className="ml-1 text-[10px] text-red-600">{err}</span>}
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
