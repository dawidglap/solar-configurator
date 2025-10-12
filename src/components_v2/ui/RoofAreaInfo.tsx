'use client';

import React, { useMemo } from 'react';

export type Pt = { x:number; y:number };

function polygonAreaPx2(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

// usa spazio non-interrompibile (NBSP) tra numero e unità
function formatM2(m2:number) {
  const nb = '\u00A0'; // NBSP
  if (m2 < 10) return `${m2.toFixed(1)}${nb}m²`;
  return `${Math.round(m2)}${nb}m²`;
}

export default function RoofAreaInfo({
  points,
  mpp,
  className = '',
  variant = 'badge', // 'badge' | 'text'
}: {
  points: Pt[];
  mpp?: number;               // meter per pixel (immagine)
  className?: string;
  variant?: 'badge' | 'text';
}) {
  const label = useMemo(() => {
    if (!mpp || points.length < 3) return null;
    const m2 = polygonAreaPx2(points) * (mpp * mpp);
    return formatM2(m2);
  }, [points, mpp]);

  if (!label) return null;

  if (variant === 'text') {
    return (
      <span className={`text-[11px] text-neutral-600 whitespace-nowrap tabular-nums ${className}`}>
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
      title="Fläche (Plan)"
    >
      {label}
    </span>
  );
}
