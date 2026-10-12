// src/components_v2/canvas/RoofHudOverlay.tsx
"use client";

import React from "react";
import type { RoofArea } from "@/types/planner";
import { resolveRoofHudPosition } from "./roofHudPosition";

export default function RoofHudOverlay({
  selectedRoof,
  roofKind,
  view,
  canvasRotationDeg,
  imageSize,
  viewportSize,
  shapeMode,
  onToggleShape,
  canToggleShape = true,
}: {
  selectedRoof: RoofArea | null;
  roofKind: "pitched" | "flat" | "green";
  view: {
    scale?: number;
    fitScale?: number;
    offsetX?: number;
    offsetY?: number;
  };
  canvasRotationDeg: number;
  imageSize: { width: number; height: number };
  viewportSize: { width: number; height: number };
  shapeMode: "normal" | "trapezio";
  onToggleShape: () => void;
  canToggleShape?: boolean;
}) {
  if (!selectedRoof) return null;

  const s = view.scale || view.fitScale || 1;
  const position = resolveRoofHudPosition({
    points: selectedRoof.points,
    roofKind,
    referenceEdgeIndex: selectedRoof.referenceEdgeIndex,
    scale: s,
    offsetX: view.offsetX || 0,
    offsetY: view.offsetY || 0,
    canvasRotationDeg,
    imageSize,
    viewportSize,
  });
  if (!position) return null;

  return (
    <>
      {/* Toggle modalità forma */}
      {canToggleShape && (
        <button
          type="button"
          aria-label="Formmodus umschalten"
          aria-pressed={shapeMode === "trapezio"}
          data-planner-interactive-control="roof-shape-mode"
          data-placement={position.placement}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleShape();
          }}
          className="pointer-events-auto absolute z-[600] -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-200 bg-white/90 px-2 py-0.5 text-[11px] text-black shadow hover:bg-white"
          style={{ left: position.left, top: position.top, touchAction: "manipulation" }}
          title="Formmodus umschalten"
        >
          {shapeMode === "normal" ? "Normal" : "Trapez"}
        </button>
      )}
    </>
  );
}
