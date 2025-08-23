'use client';

import { useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

function chooseMeters(minPx: number, maxPx: number, mppCanvas: number) {
  const minM = minPx * mppCanvas;
  const maxM = maxPx * mppCanvas;
  const pow10 = Math.pow(10, Math.floor(Math.log10(minM)));
  const candidates: number[] = [];
  [1, 2, 5].forEach(k => {
    candidates.push(k * pow10);
    candidates.push(k * pow10 * 10);
  });
  let best = candidates[0];
  for (const m of candidates) {
    if (m >= minM && m <= maxM) { best = m; break; }
    if (Math.abs(m - minM) < Math.abs(best - minM)) best = m;
  }
  return best;
}

export default function ScaleIndicator() {
  const snap = usePlannerV2Store(s => s.snapshot);
  const view = usePlannerV2Store(s => s.view);

  const { label, widthPx } = useMemo(() => {
    if (!snap.mppImage) return { label: '', widthPx: 0 };
    const mppCanvas = snap.mppImage / (view.scale || 1);
    const meters = chooseMeters(70, 120, mppCanvas);        // barra molto piccola
    const px = Math.round(meters / mppCanvas);
    const pretty =
      meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 5000 ? 0 : 1)} km`
    : meters >= 10   ? `${meters.toFixed(0)} m`
                     : `${meters.toFixed(1)} m`;
    return { label: pretty, widthPx: px };
  }, [snap.mppImage, view.scale]);

  if (!label || widthPx <= 0) return null;

  const barWidth = Math.max(50, Math.min(120, widthPx));

  return (
    <div className="pointer-events-none select-none absolute left-3 bottom-3 z-50">
      <div className="flex items-center gap-2">
        {/* barra: la lunghezza nera = valore etichetta */}
        <div className="relative" style={{ width: barWidth }}>
          {/* sottile contorno chiaro per leggibilità */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/65 blur-[0.2px]" />
          {/* linea nera principale */}
          <div className="relative h-[2px] rounded-full bg-black/85" />
        </div>
        <span className="text-[10px] leading-none font-medium text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
          {label}
        </span>
      </div>
    </div>
  );
}
