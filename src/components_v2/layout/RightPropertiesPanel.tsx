'use client';

import { ChangeEvent, useState } from 'react';
import type { PlannerStep } from '../state/plannerV2Store';
import { usePlannerV2Store } from '../state/plannerV2Store';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';

/** ground-resolution 3857 (m/px) */
function metersPerPixel3857(latDeg: number, zoom: number) {
  const EARTH_CIRCUMFERENCE = 40075016.68557849;
  const latRad = (latDeg * Math.PI) / 180;
  const resEquator = EARTH_CIRCUMFERENCE / 256 / Math.pow(2, zoom);
  return resEquator * Math.cos(latRad);
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

      // swisstopo – mosaico WMTS
      const width = 2800;
      const height = 1800;

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

  /** Utility: controlla se un layer ha esattamente 4 punti (rettangolo/quad) */
  const isQuad = (pts?: { x: number; y: number }[]) => (pts?.length ?? 0) === 4;

  /** One-shot: converte il quad selezionato in trapezio “20%” (stile Reonic demo) */
  const toTrapezoid20 = () => {
    if (!layer || !isQuad(layer.points)) return;
    const [p0, p1, p2, p3] = layer.points;

    // base = p0->p1, top = p3->p2 (ordine coerente con il nostro rectFrom3)
    const bx = p1.x - p0.x, by = p1.y - p0.y;
    const bl = Math.hypot(bx, by) || 1;
    const ux = bx / bl, uy = by / bl;

    // 20% della base → riduzione simmetrica, metà per lato
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
            {/* In seguito: Dreieck, Slider % ecc. */}
          </div>

          {/* Pendenze (lasciamo com’erano) */}
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
