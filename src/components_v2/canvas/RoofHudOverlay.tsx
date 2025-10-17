// src/components_v2/canvas/RoofHudOverlay.tsx
'use client';

import React from 'react';
import EdgeLengthBadges from './EdgeLengthBadges';

type Pt = { x: number; y: number };
type Roof = { id: string; points: Pt[]; azimuthDeg?: number; tiltDeg?: number } | null;

export default function RoofHudOverlay({
  selectedRoof,
  view,
  shapeMode,
  onToggleShape,
  mpp,
  edgeColor,
  // ⬇️ nuovi: dimensioni immagine e rotazione del contenuto Konva
  imgW,
  imgH,
  rotateDeg = 0,
}: {
  selectedRoof: Roof;
  view: { scale?: number; fitScale?: number; offsetX?: number; offsetY?: number };
  shapeMode: 'normal' | 'trapezio';
  onToggleShape: () => void;
  mpp?: number | null;
  edgeColor: string;
  imgW: number;
  imgH: number;
  rotateDeg?: number;
}) {
  if (!selectedRoof) return null;

  const s  = view.scale || view.fitScale || 1;
  const ox = view.offsetX || 0;
  const oy = view.offsetY || 0;

  // bbox in coordinate immagine (per posizionare il toggle)
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const p of selectedRoof.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
  }
  const midXImg = (minX + maxX) / 2;

  // posizione sullo Stage (HUD fisso in screen-space)
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

      {/* Etichette lunghezze lati (corrette per inclinazione e allineate alla rotazione) */}
      {mpp && imgW > 0 && imgH > 0 && (
        <EdgeLengthBadges
          points={selectedRoof.points}
          mpp={mpp}
          view={view}
          imgW={imgW}
          imgH={imgH}
          rotateDeg={rotateDeg}
          color={edgeColor}
          tiltDeg={selectedRoof.tiltDeg}
          eavesAzimuthDeg={selectedRoof.azimuthDeg}
        />
      )}
    </>
  );
}
