'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';
import { metersPerPixel3857, lonLatTo3857, bboxLonLatFromCenter } from '../utils/geo';
import { fetchRoofPolysForSnapshot } from '@/components_v2/services/sonnendach';

/** Cluster “building” invariato */
function pickRoofsForBuildingV1Style(
  polys: { id:string; pointsPx:{x:number;y:number}[]; tiltDeg?:number; azimuthDeg?:number }[],
  snap: { width?: number; height?: number },
  opts?: { radiusPx?: number; expandGrowPx?: number; minAreaPx2?: number }
) {
  const W = snap.width ?? 0, H = snap.height ?? 0;
  const cx = W / 2, cy = H / 2;
  const { radiusPx = Math.max(80, Math.min(W, H) * 0.10), expandGrowPx = 12, minAreaPx2 = 700 } = opts ?? {};

  const areaPx2 = (pts:{x:number;y:number}[]) => { let a=0; for (let i=0,j=pts.length-1;i<pts.length;j=i++) a += (pts[j].x+pts[i].x)*(pts[j].y-pts[i].y); return Math.abs(a/2); };
  const centroid = (pts:{x:number;y:number}[]) => { let sx=0, sy=0; for (const p of pts){ sx+=p.x; sy+=p.y; } const n=Math.max(1,pts.length); return { x:sx/n, y:sy/n }; };
  const bbox = (pts:{x:number;y:number}[]) => { let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of pts){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
    return { minX, minY, maxX, maxY };
  };
  const expand = (b:any,m:number) => ({ minX:b.minX-m, minY:b.minY-m, maxX:b.maxX+m, maxY:b.maxY+m });
  const overlap = (a:any,b:any) => !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);

  const inRadius: typeof polys = [];
  for (const p of polys) {
    const A = areaPx2(p.pointsPx); if (A < minAreaPx2) continue;
    const c = centroid(p.pointsPx);
    const d2 = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (d2 <= radiusPx ** 2) inRadius.push(p);
  }
  if (!inRadius.length) return [];

  let seed = inRadius[0], best = { d2: Number.POSITIVE_INFINITY, area: -1 };
  for (const p of inRadius) {
    const c = centroid(p.pointsPx), d2 = (c.x - cx) ** 2 + (c.y - cy) ** 2, A = areaPx2(p.pointsPx);
    if (d2 < best.d2 - 1e-6 || (Math.abs(d2-best.d2) < 1e-6 && A > best.area)) { best = { d2, area: A }; seed = p; }
  }

  const seedBox = expand(bbox(seed.pointsPx), expandGrowPx);
  const cluster: typeof polys = [];
  for (const p of inRadius) { const b = bbox(p.pointsPx); if (overlap(seedBox, b)) cluster.push(p); }

  return cluster.length ? cluster : [seed];
}

export default function TopbarAddressSearch() {
  const setSnapshot      = usePlannerV2Store(s => s.setSnapshot);
  const setDetectedRoofs = usePlannerV2Store(s => s.setDetectedRoofs);
  const clearDetected    = usePlannerV2Store(s => s.clearDetectedRoofs);
  const setUI            = usePlannerV2Store(s => s.setUI);

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

      setSnapshot(snapObj);
      clearDetected();

      const raw = await fetchRoofPolysForSnapshot(snapObj, 'de');
      const building = pickRoofsForBuildingV1Style(raw, snapObj, {
        radiusPx: Math.max(80, Math.min(w, h) * 0.10), expandGrowPx: 12, minAreaPx2: 700
      });

      setDetectedRoofs(building.map((p, i) => ({
        id: `sd_${p.id}_${i}`,
        points: p.pointsPx,
        tiltDeg: p.tiltDeg,
        azimuthDeg: p.azimuthDeg,
        source: 'sonnendach' as const
      })));
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
          flex min-w-[360px] max-w-[64vw] items-center gap-2
          h-9 rounded-full border border-neutral-300 bg-white pl-2 pr-2
          focus-within:ring-1 focus-within:ring-neutral-400
          overflow-visible
        `}
        aria-busy={loading ? 'true' : 'false'}
      >
        <Search className="h-4 w-4 text-neutral-500 shrink-0" />

        <div className="relative flex-1">
          {/* blocco input quando loading (senza toccare AddressSearchOSM) */}
          {loading && (
            <div className="absolute inset-0 z-10 cursor-wait rounded-full bg-transparent" />
          )}
          {/* NB: AddressSearchOSM non accetta 'disabled' o altre prop extra */}
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

      {/* Fallback globale: forza z-index altissimo sui vari menu/suggest delle librerie più comuni */}
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
