'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FiSearch } from 'react-icons/fi';

import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';
import { metersPerPixel3857, lonLatTo3857, bboxLonLatFromCenter } from '../utils/geo';
import { fetchRoofPolysForSnapshot } from '@/components_v2/services/sonnendach';

/** Cluster “building” partendo dal centro immagine (stessa logica di prima) */
/** Cluster "building" stile v1: 
 *  1) filtra per raggio dal centro immagine
 *  2) seed = poligono più vicino (o più grande tra i vicini)
 *  3) include SOLO poligoni che (a) stanno nel raggio E (b) overlap con seed bbox espanso di poco
 */
function pickRoofsForBuildingV1Style(
  polys: { id:string; pointsPx:{x:number;y:number}[]; tiltDeg?:number; azimuthDeg?:number }[],
  snap: { width?: number; height?: number },
  opts?: { radiusPx?: number; expandGrowPx?: number; minAreaPx2?: number }
) {
  const W = snap.width ?? 0, H = snap.height ?? 0;
  const cx = W / 2, cy = H / 2;

  const {
    radiusPx     = Math.max(80, Math.min(W, H) * 0.10), // ~10% del lato min, min 80 px
    expandGrowPx = 12,                                   // piccolo → evita “catene” di edifici
    minAreaPx2   = 700,
  } = opts ?? {};

  const areaPx2 = (pts:{x:number;y:number}[]) => {
    let a=0; for (let i=0,j=pts.length-1;i<pts.length;j=i++) a += (pts[j].x+pts[i].x)*(pts[j].y-pts[i].y);
    return Math.abs(a/2);
  };
  const centroid = (pts:{x:number;y:number}[]) => {
    let sx=0, sy=0; for (const p of pts){ sx+=p.x; sy+=p.y; } const n=Math.max(1,pts.length);
    return { x:sx/n, y:sy/n };
  };
  const bbox = (pts:{x:number;y:number}[]) => {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of pts){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
    return { minX, minY, maxX, maxY };
  };
  const expand = (b:any,m:number) => ({ minX:b.minX-m, minY:b.minY-m, maxX:b.maxX+m, maxY:b.maxY+m });
  const overlap = (a:any,b:any) => !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);

  // 1) GATE: distanza dal centro
  const inRadius: typeof polys = [];
  for (const p of polys) {
    const A = areaPx2(p.pointsPx);
    if (A < minAreaPx2) continue;
    const c = centroid(p.pointsPx);
    const d2 = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy);
    if (d2 <= radiusPx * radiusPx) inRadius.push(p);
  }
  if (!inRadius.length) return [];

  // 2) seed: più vicino al centro (tie-break: area più grande)
  let seed = inRadius[0];
  let best = { d2: Number.POSITIVE_INFINITY, area: -1 };
  for (const p of inRadius) {
    const c = centroid(p.pointsPx);
    const d2 = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy);
    const A  = areaPx2(p.pointsPx);
    if (d2 < best.d2 - 1e-6 || (Math.abs(d2 - best.d2) < 1e-6 && A > best.area)) {
      best = { d2, area: A };
      seed = p;
    }
  }

  // 3) cluster: SOLO in raggio E con overlap col seed bbox espanso
  const seedBox = expand(bbox(seed.pointsPx), expandGrowPx);
  const cluster: typeof polys = [];
  for (const p of inRadius) {
    const b = bbox(p.pointsPx);
    if (overlap(seedBox, b)) cluster.push(p);
  }

  // fallback: se qualcosa è andato storto, torna almeno il seed
  return cluster.length ? cluster : [seed];
}


export default function CenterAddressSearchOverlay() {
  const setSnapshot      = usePlannerV2Store(s => s.setSnapshot);
  const setDetectedRoofs = usePlannerV2Store(s => s.setDetectedRoofs);
  const clearDetected    = usePlannerV2Store(s => s.clearDetectedRoofs);
  const setUI            = usePlannerV2Store(s => s.setUI);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // stessa pipeline del right panel, ma triggerata dalla barra centrale
  const startFromAddress = async (lat: number, lon: number) => {
    setErr(null);
    setLoading(true);
    try {
      const ZOOM = 20;
      const { dataUrl, width: w, height: h } = await buildTiledSnapshot({
        lat, lon, zoom: ZOOM, width: 2800, height: 1800, scale: 1,
        tileUrl: TILE_SWISSTOPO_SAT, attribution: '© swisstopo',
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
  radiusPx: Math.max(80, Math.min(w, h) * 0.10), // dinamico per lo zoom/size
  expandGrowPx: 12,
  minAreaPx2: 700,
});

      setDetectedRoofs(building.map((p, i) => ({
        id: `sd_${p.id}_${i}`,
        points: p.pointsPx,
        tiltDeg: p.tiltDeg,
        azimuthDeg: p.azimuthDeg,
        source: 'sonnendach' as const,
      })));

      setUI({ rightPanelOpen: true });
    } catch (e: any) {
      setErr(e?.message ?? 'Unbekannter Fehler.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] pointer-events-auto">
      {/* Hero gradient alla Lovable */}
      <div
        className={[
          'absolute inset-0',
          "bg-[radial-gradient(1200px_600px_at_50%_-10%,theme(colors.blue.100),transparent),radial-gradient(900px_500px_at_50%_110%,theme(colors.rose.100),transparent)]",
          'opacity-95'
        ].join(' ')}
      />
      {/* leggero blur per staccare la mappa */}
      <div className="absolute inset-0 backdrop-blur-[2px]" />

      {/* Contenuto centrato */}
      <div className="relative h-full w-full flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="w-[min(92vw,860px)]"
        >
          {/* Headline + subcopy */}
          <div className="mb-6 text-center">
            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-neutral-900">
              Starte mit deiner Adresse
            </h1>
            <p className="mt-2 text-sm sm:text-base text-neutral-600">
              Wir laden die Orthofotos und automatisch erkannten Dachflächen für dich.
            </p>
          </div>

          {/* Search pill */}
          <div className="relative mx-auto rounded-full bg-white/92 border border-neutral-200 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/86">
            <div className="flex items-center gap-2 px-6 sm:px-8 pb-2 pt-4">
              <FiSearch className="text-neutral-600 text-xl shrink-0" />
              <div className="flex-1">
                <AddressSearchOSM
                  placeholder="Los geht’s: Wie lautet deine Adresse?"
                  onPick={(r) => startFromAddress(r.lat, r.lon)}
                />
              </div>
              {loading && <div className="text-xs text-neutral-500 px-1">Lädt…</div>}
            </div>

            {/* fine-pill micro footer */}
            <div className="px-5 pb-3 pt-0 text-[11px] text-indigo-400 text-center">
              Tipp: Einen Eintrag aus der Liste wählen oder Enter drücken.
            </div>
          </div>

          {/* errore (se c'è) */}
          {err && (
            <p className="mt-3 text-center text-sm text-red-600">
              {err}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
