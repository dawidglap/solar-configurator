// src/components_v2/modules/GridRotationControl.tsx
'use client';

import React from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

const MIN_ANGLE = -90;
const MAX_ANGLE = 90;

function clampAngle(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, Math.round(v)));
}

export default function GridRotationControl() {
  const panels = usePlannerV2Store((s) => s.panels);
  const selectedIds = usePlannerV2Store(
    (s) => (s.selectedPanelIds as string[] | undefined) || []
  );
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);

  const hasSelection = selectedIds.length > 0;

  const selectedPanels = React.useMemo(
    () => panels.filter((p) => selectedIds.includes(p.id)),
    [panels, selectedIds]
  );

  // angolo "medio" (in pratica quello del primo pannello selezionato)
  const effectiveAngle = React.useMemo(() => {
    if (!selectedPanels.length) return 0;
    const first = selectedPanels[0];
    const a = typeof first.angleDeg === 'number' ? first.angleDeg : 0;
    return clampAngle(a);
  }, [selectedPanels]);

  // centro del gruppo (bbox dei pannelli selezionati)
  const groupCenter = React.useMemo(() => {
    if (!selectedPanels.length) return { cx: 0, cy: 0, valid: false };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of selectedPanels) {
      const cx = p.cx;
      const cy = p.cy;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return { cx: 0, cy: 0, valid: false };
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      valid: true,
    };
  }, [selectedPanels]);

  // stato locale dello slider (per calcolare il delta)
  const [sliderAngle, setSliderAngle] = React.useState<number>(0);
  const selectionKeyRef = React.useRef<string>('');

  // ogni volta che cambia la selezione, resync lo slider all'angolo attuale
  React.useEffect(() => {
    const key = selectedIds.slice().sort().join(',');
    if (key !== selectionKeyRef.current) {
      selectionKeyRef.current = key;
      setSliderAngle(effectiveAngle);
    }
  }, [selectedIds, effectiveAngle]);

  const applyAngle = (nextAngle: number) => {
    if (!hasSelection || !groupCenter.valid) return;

    const next = clampAngle(nextAngle);
    const delta = next - sliderAngle;
    if (delta === 0) {
      setSliderAngle(next);
      return;
    }

    const rad = (delta * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const gcx = groupCenter.cx;
    const gcy = groupCenter.cy;

    for (const p of selectedPanels) {
      const oldAngle = typeof p.angleDeg === 'number' ? p.angleDeg : 0;
      const newAngle = clampAngle(oldAngle + delta);

      const dx = p.cx - gcx;
      const dy = p.cy - gcy;
      const nx = gcx + dx * cos - dy * sin;
      const ny = gcy + dx * sin + dy * cos;

      updatePanel(p.id, { angleDeg: newAngle, cx: nx, cy: ny } as any);
    }

    setSliderAngle(next);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasSelection) return;
    applyAngle(Number(e.target.value));
  };

  const stepMinus = () => applyAngle(sliderAngle - 1);
  const stepPlus = () => applyAngle(sliderAngle + 1);
  const resetZero = () => applyAngle(0);

  return (
 <fieldset className="space-y-1.5">
  {/* titolo + valore attuale */}
  <div className="flex items-center justify-between">
    <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-400">
      Modulrotation (Auswahl)
    </label>
    <span className="text-[10px] text-neutral-300 tabular-nums">
      {hasSelection ? `${sliderAngle}°` : '—'}
    </span>
  </div>

  {/* box controlli */}
  <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-2.5 py-2 space-y-1.5">
    <div className="flex items-center gap-2">
      {/* -1° */}
      <button
        type="button"
        disabled={!hasSelection}
        className={`h-7 px-2 rounded-full text-[10px] leading-none border transition ${
          hasSelection
            ? 'border-neutral-700 text-neutral-100 hover:bg-neutral-800'
            : 'border-neutral-800 text-neutral-600 cursor-not-allowed'
        }`}
        onClick={stepMinus}
        title="-1°"
        aria-label="Ausgewählte Module um -1° drehen"
      >
        −°
      </button>

      {/* slider + etichette min/0/max */}
      <div className="flex-1 flex flex-col gap-1">
        <input
          type="range"
          min={MIN_ANGLE}
          max={MAX_ANGLE}
          step={1}
          value={hasSelection ? sliderAngle : 0}
          onChange={handleSliderChange}
          className="w-full accent-neutral-200 disabled:opacity-40"
          aria-label="Rotationswinkel der ausgewählten Module (°)"
          disabled={!hasSelection}
        />
        <div className="flex justify-between text-[9px] text-neutral-500 tabular-nums">
          <span>-90°</span>
          <span>0°</span>
          <span>+90°</span>
        </div>
      </div>

      {/* +1° */}
      <button
        type="button"
        disabled={!hasSelection}
        className={`h-7 px-2 rounded-full text-[10px] leading-none border transition ${
          hasSelection
            ? 'border-neutral-700 text-neutral-100 hover:bg-neutral-800'
            : 'border-neutral-800 text-neutral-600 cursor-not-allowed'
        }`}
        onClick={stepPlus}
        title="+1°"
        aria-label="Ausgewählte Module um +1° drehen"
      >
        +°
      </button>
    </div>

    {/* helper text + reset */}
    <div className="flex items-center justify-between gap-2 text-[9px] text-neutral-400">
      <span className="leading-snug">
        {hasSelection
          ? 'Dreht alle ausgewählten Module um einen gemeinsamen Mittelpunkt.'
          : 'Wähle ein oder mehrere Module aus, um sie gemeinsam zu drehen.'}
      </span>

      <button
        type="button"
        disabled={!hasSelection}
        className={
          hasSelection
            ? 'h-6 px-2 rounded-full border border-neutral-700 text-[9px] leading-none text-neutral-100 hover:bg-neutral-800'
            : 'h-6 px-2 rounded-full border border-neutral-800 text-[9px] leading-none text-neutral-600 cursor-not-allowed'
        }
        onClick={resetZero}
        title="Rotation der ausgewählten Module auf 0° zurücksetzen"
      >
        Auf 0°
      </button>
    </div>
  </div>
</fieldset>

  );
}
