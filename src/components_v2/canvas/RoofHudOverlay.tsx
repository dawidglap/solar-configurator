// src/components_v2/canvas/RoofHudOverlay.tsx
"use client";

import React from "react";

type Pt = { x: number; y: number };
type Roof = {
  id: string;
  points: Pt[];
  azimuthDeg?: number;
  fallAzimuthDeg?: number;
  tiltDeg?: number;
  source?: "manual" | "sonnendach";
} | null;

export default function RoofHudOverlay({
  selectedRoof,
  view,
  shapeMode,
  onToggleShape,
  canToggleShape = true,
}: {
  selectedRoof: Roof;
  view: {
    scale?: number;
    fitScale?: number;
    offsetX?: number;
    offsetY?: number;
  };
  shapeMode: "normal" | "trapezio";
  onToggleShape: () => void;
  canToggleShape?: boolean;
}) {
  if (!selectedRoof) return null;

  const s = view.scale || view.fitScale || 1;
  const ox = view.offsetX || 0;
  const oy = view.offsetY || 0;

  // bbox in coordinate immagine (per posizionare il toggle)
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity;
  for (const p of selectedRoof.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
  }
  const midXImg = (minX + maxX) / 2;

  // posizione sullo Stage (HUD fisso in screen-space)
  const left = ox + midXImg * s;
  const top = Math.max(8, oy + minY * s - 36);
  return (
    <>
      {/* Toggle modalità forma */}
      {canToggleShape && (
        <button
          onClick={onToggleShape}
          className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 text-black rounded-full border border-neutral-200 bg-white/90 px-2 py-0.5 text-[11px] shadow hover:bg-white"
          style={{ left, top }}
          title="Formmodus umschalten"
        >
          {shapeMode === "normal" ? "Normal" : "Trapez"}
        </button>
      )}
    </>
  );
}
