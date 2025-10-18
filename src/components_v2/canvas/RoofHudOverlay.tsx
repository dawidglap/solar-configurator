'use client';

import React from 'react';
import EdgeLengthBadges from './EdgeLengthBadges';

type Pt = { x: number; y: number };
type Roof = { id: string; points: Pt[] } | null;

export default function RoofHudOverlay({
  selectedRoof,
  view,
  shapeMode,
  onToggleShape,
  mpp,
  edgeColor,
}: {
  selectedRoof: Roof;
  view: { scale?: number; fitScale?: number; offsetX?: number; offsetY?: number };
  shapeMode: 'normal' | 'trapezio';
  onToggleShape: () => void;
  mpp?: number | null;
  edgeColor: string;
}) {
  if (!selectedRoof) return null;

  const s  = view.scale || view.fitScale || 1;
  const ox = view.offsetX || 0;
  const oy = view.offsetY || 0;

  // bbox in coordinate immagine
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const p of selectedRoof.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
  }
  const midXImg = (minX + maxX) / 2;

  // posizione sullo Stage
  const left = ox + midXImg * s;
  const top  = Math.max(8, oy + minY * s - 36);

  return (
    <>
      {/* Toggle modalità forma */}
      <button
        onClick={onToggleShape}
        className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-200 bg-white/90 px-2 py-0.5 text-[11px] shadow hover:bg-white"
        style={{ left, top }}
        title="Formmodus umschalten"
      >
        {shapeMode === 'normal' ? 'Normal' : 'Trapez'}
      </button>

      {/* Etichette lunghezze lati */}
      {mpp && (
        <EdgeLengthBadges
          points={selectedRoof.points}
          mpp={mpp}
          view={view}
          color={edgeColor}
        />
      )}
    </>
  );
}
