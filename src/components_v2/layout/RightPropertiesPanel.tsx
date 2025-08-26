'use client';

import { ChangeEvent, useState } from 'react';
import type { PlannerStep } from '../state/plannerV2Store';
import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';
import { metersPerPixel3857, lonLatTo3857 } from '../utils/geo';
import { fetchRoofPolysForSnapshot } from '@/components_v2/services/sonnendach';
import { bboxLonLatFromCenter } from '../utils/geo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';


// SOSTITUISCI la tua pickRoofsNearCenter con questa
function pickRoofsForBuilding(
  polys: { id:string; pointsPx:{x:number;y:number}[]; tiltDeg?:number; azimuthDeg?:number }[],
  snap: { width?: number; height?: number },
  opts?: { expandGrowPx?: number; minAreaPx2?: number }
) {
  const cx = (snap.width ?? 0) / 2;
  const cy = (snap.height ?? 0) / 2;

  const { expandGrowPx = 48, minAreaPx2 = 700 } = opts ?? {};

  const areaPx2 = (pts:{x:number;y:number}[]) => {
    let a=0; for (let i=0,j=pts.length-1;i<pts.length;j=i++)
      a += (pts[j].x+pts[i].x)*(pts[j].y-pts[i].y);
    return Math.abs(a/2);
  };
  const centroid = (pts:{x:number;y:number}[]) => {
    let sx=0, sy=0; for (const p of pts){ sx+=p.x; sy+=p.y; }
    const n=Math.max(1,pts.length); return { x:sx/n, y:sy/n };
  };
  const bbox = (pts:{x:number;y:number}[]) => {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of pts){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y;
                          if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
    return { minX, minY, maxX, maxY };
  };
  const overlap = (a:any,b:any) =>
    !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
  const expand = (b:any,m:number) =>
    ({ minX:b.minX-m, minY:b.minY-m, maxX:b.maxX+m, maxY:b.maxY+m });

  // 0) scarta frammenti minuscoli
  const items = polys.filter(p => areaPx2(p.pointsPx) >= minAreaPx2);
  if (!items.length) return [];

  // 1) seed = più vicino al centro immagine
  let seed = items[0]; let best = Number.POSITIVE_INFINITY;
  for (const p of items){
    const c = centroid(p.pointsPx);
    const d = (c.x-cx)*(c.x-cx) + (c.y-cy)*(c.y-cy);
    if (d < best){ best=d; seed=p; }
  }

  // 2) crescita del cluster per contiguità (bbox)
  const cluster: typeof polys = [seed];
  let unionBox = bbox(seed.pointsPx);
  let changed = true;

  while (changed) {
    changed = false;
    const grow = expand(unionBox, expandGrowPx);
    for (const p of items) {
      if (cluster.includes(p)) continue;
      const b = bbox(p.pointsPx);
      if (overlap(grow, b)) {
        cluster.push(p);
        unionBox = {
          minX: Math.min(unionBox.minX, b.minX),
          minY: Math.min(unionBox.minY, b.minY),
          maxX: Math.max(unionBox.maxX, b.maxX),
          maxY: Math.max(unionBox.maxY, b.maxY),
        };
        changed = true;
      }
    }
  }

  return cluster;
}






export default function RightPropertiesPanel({ currentStep }: { currentStep?: PlannerStep }) {
  const step = currentStep ?? 'building';
  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-2.5 text-[13px] font-medium">Eigenschaften</header>
      <div className="flex-1 overflow-y-auto p-2.5 text-sm">
        {step === 'building' && <BuildingPanel />}
        {step === 'modules' && <p className="text-neutral-600">Modultyp, Orientierung, Abstände – kommen gleich.</p>}
        {step === 'strings' && <p className="text-neutral-600">Stringplanung (später).</p>}
        {step === 'parts' && <p className="text-neutral-600">Stückliste & Preise (später).</p>}
      </div>
    </div>
  );
}

function BuildingPanel() {
  const snapshot = usePlannerV2Store((s) => s.snapshot);
  const setSnapshot = usePlannerV2Store((s) => s.setSnapshot);
  const view = usePlannerV2Store((s) => s.view);

  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const layer = usePlannerV2Store((s) => s.layers.find((l) => l.id === s.selectedId));
  const updateRoof = usePlannerV2Store((s) => s.updateRoof);

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | ''>('');
  const [lon, setLon] = useState<number | ''>('');
  const [zoom, setZoom] = useState<number>(20);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setDetectedRoofs = usePlannerV2Store((s) => s.setDetectedRoofs);
  const clearDetectedRoofs = usePlannerV2Store((s) => s.clearDetectedRoofs);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result as string;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSnapshot({ url, width: img.naturalWidth, height: img.naturalHeight });
      clearDetectedRoofs(); // non sappiamo la georeferenza dell’upload
    };
    img.src = url;
  };
  reader.readAsDataURL(f);
};


 const loadStaticSnapshot = async (override?: { lat: number; lon: number; zoom?: number }) => {
  setErr(null);

  const usedLat = override?.lat ?? lat;
  const usedLon = override?.lon ?? lon;
  const usedZoom = override?.zoom ?? zoom;
  if (usedLat === '' || usedLon === '') {
    setErr('Bitte Koordinaten (Lat/Lon) angeben.');
    return;
  }

  try {
    setLoading(true);
    const width = 2800, height = 1800;

    const { dataUrl, width: w, height: h } = await buildTiledSnapshot({
      lat: Number(usedLat),
      lon: Number(usedLon),
      zoom: usedZoom,
      width,
      height,
      scale: 1,
      tileUrl: TILE_SWISSTOPO_SAT,
      attribution: '© swisstopo',
    });

    // bbox precisa via world-pixel
    const center = { lat: Number(usedLat), lon: Number(usedLon) };
    const { minLon, minLat, maxLon, maxLat } = bboxLonLatFromCenter(
      { lon: center.lon, lat: center.lat }, usedZoom, w, h
    );
    const bl = lonLatTo3857(minLon, minLat);
    const tr = lonLatTo3857(maxLon, maxLat);

    const snapObj = {
      url: dataUrl,
      width: w,
      height: h,
      mppImage: metersPerPixel3857(center.lat, usedZoom),
      center,
      zoom: usedZoom,
      bbox3857: { minX: bl.x, minY: bl.y, maxX: tr.x, maxY: tr.y },
    } as const;

    // 1) salva snapshot
    setSnapshot(snapObj);

    // 2) fetch + filtro → store
    clearDetectedRoofs();
const raw = await fetchRoofPolysForSnapshot(snapObj, 'de');
const building = pickRoofsForBuilding(raw, snapObj, {
  expandGrowPx: 48,   // ↑ riduci a 32–40 se prende ancora la casa sotto
  minAreaPx2: 700,    // ↑ alza se vuoi ignorare pezzetti minuscoli
});

clearDetectedRoofs();
setDetectedRoofs(building.map((p, i) => ({
  id: `sd_${p.id}_${i}`,
  points: p.pointsPx,
  tiltDeg: p.tiltDeg,
  azimuthDeg: p.azimuthDeg,
  source: 'sonnendach' as const,
})));


  } catch (e: any) {
    setErr(e?.message ?? 'Unbekannter Fehler.');
  } finally {
    setLoading(false);
  }
};


  // helpers forma tetto
  const isQuad = (pts?: { x: number; y: number }[]) => (pts?.length ?? 0) === 4;

  const toTrapezoid20 = () => {
    if (!layer || !isQuad(layer.points)) return;
    const [p0, p1, p2, p3] = layer.points;

    // base p0->p1 (coerente con rectFrom3), stringiamo il lato opposto del 20% simmetrico
    const bx = p1.x - p0.x, by = p1.y - p0.y;
    const bl = Math.hypot(bx, by) || 1;
    const ux = bx / bl, uy = by / bl;

    const insetEach = (0.20 * bl) / 2;
    const dx = ux * insetEach, dy = uy * insetEach;

    const p2p = { x: p2.x - dx, y: p2.y - dy };
    const p3p = { x: p3.x + dx, y: p3.y + dy };

    updateRoof(layer.id, { points: [p0, p1, p2p, p3p] });
  };

  return (
    <div className="space-y-5">
      {/* A) Adresse / Snapshot */}
      <section>
        <h3 className="mb-2 text-xs font-semibold text-neutral-900">Adresse / Snapshot</h3>

        <div className="mb-2">
          <label className="block text-[11px] text-neutral-600">Adresse</label>
          <AddressSearchOSM
            onPick={(r) => {
              setAddress(r.label);
              setLat(r.lat);
              setLon(r.lon);
              setZoom(20);
              loadStaticSnapshot({ lat: r.lat, lon: r.lon, zoom: 20 });
            }}
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Tipp: Einen Eintrag aus der Liste wählen oder Enter drücken.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-neutral-600">Zoom</label>
            <input
              type="number"
              min={14}
              max={20}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full rounded-md border px-2 py-1 text-[13px]"
            />
            <p className="mt-1 text-[11px] text-neutral-500">Max: 20 (swisstopo)</p>
          </div>
        </div>

        <button
          onClick={() => loadStaticSnapshot()}
          disabled={loading}
          className="mt-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
          title="Statisches Kartenbild laden"
        >
          {loading ? 'Lädt…' : 'Statisches Snapshot laden'}
        </button>

<DetectedRoofsImport />

        {err && <p className="mt-2 text-[11px] text-red-600">{err}</p>}
        {snapshot.url && (
          <p className="mt-2 text-[11px] text-neutral-500">
            Bildgröße: {snapshot.width} × {snapshot.height}px — m/px: {snapshot.mppImage?.toFixed(3)}
          </p>
        )}
      </section>

      {/* B) Upload (Fallback) */}
      <section>
        <h3 className="mb-2 text-xs font-semibold text-neutral-900">Hintergrund (Upload)</h3>
        <div className="space-y-2">
          <label className="block text-[11px] text-neutral-600">Screenshot/Bild laden</label>
          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="w-full cursor-pointer rounded-md border px-2 py-1.5 text-[13px]"
            title="Screenshot/Bild hochladen"
          />
        </div>
      </section>

      {/* C) Kalibrierung */}
      <section>
        <h3 className="mb-2 text-xs font-semibold text-neutral-900">Kalibrierung</h3>
        <div className="space-y-1.5">
          <label className="block text-[11px] text-neutral-600">Meter pro Bildpixel (m/px)</label>
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder="z.B. 0.25"
            value={snapshot.mppImage ?? ''}
            onChange={(e) =>
              usePlannerV2Store.getState().setSnapshot({
                mppImage: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-40 rounded-md border px-2 py-1.5 text-[13px]"
            title="Metermass des Bildes (m/px)"
          />
          {snapshot.mppImage && (
            <p className="text-[11px] text-neutral-500">
              Canvas-Skala: 1 px ≈ {(snapshot.mppImage / (view.scale || 1)).toFixed(3)} m
            </p>
          )}
        </div>
      </section>

      {/* D) Dach-Eigenschaften / Form */}
      {selectedId && layer && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-neutral-900">Dach-Form</h3>

          <div className="flex items-center gap-1">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px]">Rechteck</span>
            <button
              type="button"
              className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] hover:bg-neutral-50 disabled:opacity-50"
              onClick={toTrapezoid20}
              disabled={!isQuad(layer.points)}
              title="In Trapez umwandeln (20%)"
            >
              → Trapez (20%)
            </button>
          </div>

          {/* Pendenze (lasciate come prima) */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-neutral-600">ΔX (°)</label>
              <input
                type="number"
                step="0.1"
                value={layer.slopeX ?? ''}
                onChange={(e) =>
                  updateRoof(layer.id, { slopeX: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-md border px-2 py-1.5 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-600">ΔY (°)</label>
              <input
                type="number"
                step="0.1"
                value={layer.slopeY ?? ''}
                onChange={(e) =>
                  updateRoof(layer.id, { slopeY: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-md border px-2 py-1.5 text-[13px]"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            Tragen Sie die Neigung (Grad) ein. Pfeile/Schraffur folgen im nächsten Schritt.
          </p>
        </section>
      )}
    </div>
  );
}
