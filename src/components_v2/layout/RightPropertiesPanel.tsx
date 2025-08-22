'use client';

import { ChangeEvent, useState } from 'react';
import type { PlannerStep } from '../state/plannerV2Store';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { buildMapTilerStaticURL, metersPerPixelAtLat } from '../utils/mapStatic';
import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { geocodeMapTiler } from '../utils/geocode';
import { buildOSMSnapshot } from '../utils/stitchTilesOSM';


export default function RightPropertiesPanel({ currentStep }: { currentStep: PlannerStep }) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-3 text-sm font-medium">Eigenschaften</header>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {currentStep === 'building' && <BuildingPanel />}
        {currentStep === 'modules' && <p className="text-neutral-600">Modultyp, Orientierung, Abstände – kommen gleich.</p>}
        {currentStep === 'strings' && <p className="text-neutral-600">Stringplanung (später).</p>}
        {currentStep === 'parts' && <p className="text-neutral-600">Stückliste & Preise (später).</p>}
      </div>
    </div>
  );
}

function BuildingPanel() {
  const snapshot = usePlannerV2Store((s) => s.snapshot);
  const setSnapshot = usePlannerV2Store((s) => s.setSnapshot);
  const view = usePlannerV2Store((s) => s.view);

  // ---- Adresse → Static Snapshot (lat/lon minimi per partire)
  const [lat, setLat] = useState<number | ''>('');
  const [lon, setLon] = useState<number | ''>('');
  const [zoom, setZoom] = useState<number>(18);
  const [style, setStyle] = useState<'streets' | 'satellite'>('streets');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [source, setSource] = useState<'osm' | 'maptiler'>('osm'); // swisstopo lo aggiungeremo dopo



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

const loadStaticSnapshot = async (
  override?: { lat: number; lon: number; zoom?: number }
) => {
  setErr(null);

  let usedLat: number | '' = override?.lat ?? lat;
  let usedLon: number | '' = lon ?? override?.lon ?? lon;
  let usedZoom: number = override?.zoom ?? zoom;

  // fallback: se hai solo l'indirizzo (opzionale)
  if ((usedLat === '' || usedLon === '') && address?.trim()) {
    const best = await geocodeMapTiler(address, { country: 'ch', language: 'de' });
    if (best) {
      usedLat = best.lat; usedLon = best.lon;
      setLat(best.lat); setLon(best.lon);
    }
  }
  if (usedLat === '' || usedLon === '') {
    setErr('Bitte Koordinaten (Lat/Lon) angeben.');
    return;
  }

  try {
    setLoading(true);

    if (source === 'osm') {
      // 🔹 OSM stitcher – nessuna key richiesta
      const width = 1400, height = 900, scale = 1 as const;
      const { dataUrl, width: w, height: h } = await buildOSMSnapshot({
        lat: Number(usedLat),
        lon: Number(usedLon),
        zoom: usedZoom,
        width,
        height,
        scale,
        drawAttribution: true,
      });

      const mpp = metersPerPixelAtLat(Number(usedLat), usedZoom, scale);
      setSnapshot({ url: dataUrl, width: w, height: h, mppImage: mpp });
      return;
    }

    // 🔹 MapTiler (opzionale)
    const reqWidth = 1400, reqHeight = 900, reqScale: 1 | 2 = 1;
    const { url } = buildMapTilerStaticURL({
      lat: Number(usedLat),
      lon: Number(usedLon),
      zoom: usedZoom,
      width: reqWidth,
      height: reqHeight,
      scale: reqScale,
      style,
    });

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
      img.src = url;
    });

    const mpp = metersPerPixelAtLat(Number(usedLat), usedZoom, reqScale);
    setSnapshot({ url, width: img.naturalWidth, height: img.naturalHeight, mppImage: mpp });
  } catch (e: any) {
    setErr(e?.message ?? 'Unbekannter Fehler.');
  } finally {
    setLoading(false);
  }
};





      


  return (
    <div className="space-y-6">
      {/* A) Adresse / Snapshot */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Adresse / Snapshot</h3>
<div className="mb-2">
  <label className="block text-xs text-neutral-600">Adresse</label>
 <AddressSearchOSM
  onPick={(r) => {
    setAddress(r.label);
    setLat(r.lat);
    setLon(r.lon);
    setZoom(18);
    loadStaticSnapshot({ lat: r.lat, lon: r.lon, zoom: 18 });
  }}
/>

  <p className="mt-1 text-[11px] text-neutral-500">
    Tipp: Einen Eintrag aus der Liste wählen oder Enter drücken.
  </p>
</div>



        <div className="grid grid-cols-2 gap-2">
            <div>
  <label className="block text-xs text-neutral-600">Quelle</label>
  <select
    value={source}
    onChange={(e) => setSource(e.target.value as any)}
    className="w-full rounded-lg border px-3 py-1.5 text-sm"
    title="Kartenquelle"
  >
    <option value="osm">OSM (kostenlos)</option>
    <option value="maptiler">MapTiler (Key)</option>
  </select>
</div>

          <div>
            <label className="block text-xs text-neutral-600">Lat</label>
            <input
              type="number"
              value={lat}
              onChange={(e) => setLat(e.target.value === '' ? '' : Number(e.target.value))}
              step="0.000001"
              className="w-full rounded-lg border px-3 py-1.5 text-sm"
              placeholder="z.B. 47.3769"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-600">Lon</label>
            <input
              type="number"
              value={lon}
              onChange={(e) => setLon(e.target.value === '' ? '' : Number(e.target.value))}
              step="0.000001"
              className="w-full rounded-lg border px-3 py-1.5 text-sm"
              placeholder="z.B. 8.5417"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-600">Zoom</label>
            <input
              type="number"
              min={14}
              max={22}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full rounded-lg border px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-600">Stil</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as any)}
              className="w-full rounded-lg border px-3 py-1.5 text-sm"
            >
              <option value="streets">Streets</option>
              <option value="satellite">Satellite</option>
            </select>
          </div>
        </div>

        <button
          onClick={loadStaticSnapshot}
          disabled={loading}
          className="mt-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          title="Statisches Kartenbild laden"
        >
          {loading ? 'Lädt…' : 'Statisches Snapshot laden'}
        </button>
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        {snapshot.url && (
          <p className="mt-2 text-xs text-neutral-500">
            Bildgröße: {snapshot.width} × {snapshot.height}px — m/px: {snapshot.mppImage?.toFixed(3)}
          </p>
        )}
      </section>

      {/* B) Upload (Fallback) */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Hintergrund (Upload)</h3>
        <div className="space-y-2">
          <label className="block text-xs text-neutral-600">Screenshot/Bild laden</label>
          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="w-full cursor-pointer rounded-lg border px-3 py-2 text-sm"
            title="Screenshot/Bild hochladen"
          />
        </div>
      </section>

      {/* C) Kalibrierung */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Kalibrierung</h3>
        <div className="space-y-2">
          <label className="block text-xs text-neutral-600">Meter pro Bildpixel (m/px)</label>
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder="z.B. 0.25"
            value={snapshot.mppImage ?? ''}
            onChange={(e) => setSnapshot({ mppImage: e.target.value ? Number(e.target.value) : undefined })}
            className="w-40 rounded-lg border px-3 py-1.5 text-sm"
            title="Metermass des Bildes (m/px)"
          />
          {snapshot.mppImage && (
            <p className="text-xs text-neutral-500">
              Canvas-Skala: 1 px ≈ {(snapshot.mppImage / (view.scale || 1)).toFixed(3)} m
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
