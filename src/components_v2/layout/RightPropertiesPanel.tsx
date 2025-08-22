'use client';

import type { PlannerStep } from '../state/plannerV2Store';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { ChangeEvent } from 'react';

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

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      // ottieni dimensioni naturali
      const img = new Image();
      img.onload = () => {
        setSnapshot({ url, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = url;
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Hintergrund</h3>
        <div className="space-y-2">
          <label className="block text-xs text-neutral-600">Screenshot/Bild laden</label>
          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="w-full cursor-pointer rounded-lg border px-3 py-2 text-sm"
            title="Screenshot/Bild hochladen"
          />
          {snapshot.url && (
            <p className="text-xs text-neutral-500">
              Bildgröße: {snapshot.width} × {snapshot.height}px
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Kalibrierung</h3>
        <div className="space-y-2">
          <label className="block text-xs text-neutral-600">
            Meter pro Bildpixel (m/px)
          </label>
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
          {!snapshot.mppImage && (
            <p className="text-xs text-neutral-500">
              Tipp: Geben Sie den m/px-Wert des Screenshots an oder kalibrieren Sie später mit einer Referenzstrecke.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
