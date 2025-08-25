'use client';

import { ChangeEvent, useState } from 'react';
import type { PlannerStep } from '../state/plannerV2Store';
import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';

/** Ground resolution EPSG:3857 (m/px) */
function metersPerPixel3857(latDeg: number, zoom: number) {
  const EARTH_CIRC = 40075016.68557849; // m
  const latRad = (latDeg * Math.PI) / 180;
  const resEquator = EARTH_CIRC / 256 / Math.pow(2, zoom);
  return resEquator * Math.cos(latRad);
}

export default function RightPropertiesPanel({ currentStep }: { currentStep?: PlannerStep }) {
  const step = currentStep ?? 'building';
  return (
    <div className="flex h-full flex-col text-[13px]">
      <header className="sticky top-0 z-10 border-b bg-white/80 px-2 py-2 backdrop-blur">
        <div className="text-xs font-semibold tracking-tight">Eigenschaften</div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
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

      // swisstopo WMTS mosaic (alta qualità, ma UI minimal)
      const width = 2400;   // leggermente più piccolo per performance, resta nitido
      const height = 1600;

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

      const mpp = metersPerPixel3857(Number(usedLat), usedZoom);
      setSnapshot({ url: dataUrl, width: w, height: h, mppImage: mpp });
    } catch (e: any) {
      setErr(e?.message ?? 'Unbekannter Fehler.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Adresse / Snapshot */}
      <section>
        <h3 className="mb-1 text-xs font-semibold text-neutral-900">Adresse / Snapshot</h3>

        <div className="mb-1">
          <label className="mb-0.5 block text-[11px] text-neutral-600">Adresse</label>
          <AddressSearchOSM
            onPick={(r) => {
              setAddress(r.label);
              setLat(r.lat);
              setLon(r.lon);
              setZoom(20);
              loadStaticSnapshot({ lat: r.lat, lon: r.lon, zoom: 20 });
            }}
          />
          <p className="mt-1 text-[11px] text-neutral-500">Tipp: Eintrag wählen oder Enter drücken.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] text-neutral-600">Zoom</label>
            <input
              type="number"
              min={14}
              max={20}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full rounded-md border px-2 py-1 text-xs"
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
          {loading ? 'Lädt…' : 'Snapshot laden'}
        </button>

        {err && <p className="mt-2 text-[11px] text-red-600">{err}</p>}
        {snapshot.url && (
          <p className="mt-2 text-[11px] text-neutral-500">
            Bildgröße: {snapshot.width} × {snapshot.height}px — m/px: {snapshot.mppImage?.toFixed(3)}
          </p>
        )}
      </section>

      {/* Upload (Fallback) */}
      <section>
        <h3 className="mb-1 text-xs font-semibold text-neutral-900">Hintergrund (Upload)</h3>
        <label className="mb-0.5 block text-[11px] text-neutral-600">Screenshot/Bild laden</label>
        <input
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="w-full cursor-pointer rounded-md border px-2 py-1.5 text-xs"
          title="Screenshot/Bild hochladen"
        />
      </section>

      {/* Kalibrierung */}
      <section>
        <h3 className="mb-1 text-xs font-semibold text-neutral-900">Kalibrierung</h3>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-neutral-600">m/px</label>
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder="z.B. 0.25"
            value={snapshot.mppImage ?? ''}
            onChange={(e) => setSnapshot({ mppImage: e.target.value ? Number(e.target.value) : undefined })}
            className="w-28 rounded-md border px-2 py-1 text-xs"
            title="Metermass des Bildes (m/px)"
          />
        </div>
        {snapshot.mppImage && (
          <p className="mt-1 text-[11px] text-neutral-500">
            Canvas: 1 px ≈ {(snapshot.mppImage / (view.scale || 1)).toFixed(3)} m
          </p>
        )}
      </section>

      {/* Dach-Eigenschaften */}
      {selectedId && layer && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-neutral-900">Dach-Eigenschaften</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-neutral-600">ΔX (°)</label>
              <input
                type="number"
                step="0.1"
                value={layer.slopeX ?? ''}
                onChange={(e) =>
                  updateRoof(layer.id, { slopeX: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-md border px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-neutral-600">ΔY (°)</label>
              <input
                type="number"
                step="0.1"
                value={layer.slopeY ?? ''}
                onChange={(e) =>
                  updateRoof(layer.id, { slopeY: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-md border px-2 py-1 text-xs"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Neigung (Grad). Pfeile/Schraffur folgen später.</p>
        </section>
      )}
    </div>
  );
}
