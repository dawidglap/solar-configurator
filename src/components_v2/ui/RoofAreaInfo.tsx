'use client';

import React, { useMemo } from 'react';

export type Pt = { x: number; y: number };

function polygonAreaPx2(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

// formatter locali
const fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatNumberM2(m2: number) {
  // solo numero formattato (senza unità)
  return m2 < 10 ? fmt1.format(m2) : fmt0.format(Math.round(m2));
}

// con NBSP per la variante con unità
function formatM2WithUnit(m2: number) {
  const nb = '\u00A0';
  return m2 < 10 ? `${fmt1.format(m2)}${nb}m²` : `${fmt0.format(Math.round(m2))}${nb}m²`;
}

export default function RoofAreaInfo({
  points,
  mpp,
  className = '',
  variant = 'badge',           // 'badge' | 'text'
  showUnit = true,
  // ⬇️ nuovi opzionali
  tiltDeg,
  correctForTilt = false,
}: {
  points: Pt[];
  mpp?: number;
  className?: string;
  variant?: 'badge' | 'text';
  showUnit?: boolean;
  /** inclinazione falda in gradi (se fornita) */
  tiltDeg?: number;
  /** se true mostra l'area corretta per inclinazione */
  correctForTilt?: boolean;
}) {
  const { label, title } = useMemo(() => {
    if (!mpp || points.length < 3) return { label: null as string | null, title: '' };

    const areaPlanM2 = polygonAreaPx2(points) * (mpp * mpp);

    let areaM2 = areaPlanM2;
    if (correctForTilt && typeof tiltDeg === 'number') {
      const rad = (tiltDeg * Math.PI) / 180;
      const cos = Math.max(0.1736, Math.cos(rad)); // ≥ cos(80°) per robustezza
      areaM2 = areaPlanM2 / cos;                   // superficie reale di falda
    }

    const label = showUnit ? formatM2WithUnit(areaM2) : formatNumberM2(areaM2);
    const title = correctForTilt
      ? `Fläche (Dach). Plan: ${formatNumberM2(areaPlanM2)} m²`
      : 'Fläche (Plan)';

    return { label, title };
  }, [points, mpp, showUnit, correctForTilt, tiltDeg]);

  if (!label) return null;

  if (variant === 'text') {
    return (
      <span
        className={`text-[11px] text-white whitespace-nowrap tabular-nums ${className}`}
        title={title}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`
        ml-2 inline-block rounded bg-neutral-100 px-1.5 py-0.5
        text-[11px] font-medium text-neutral-700
        whitespace-nowrap tabular-nums ${className}
      `}
      title={title}
    >
      {label}
    </span>
  );
}
