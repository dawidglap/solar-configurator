"use client";

import React from "react";
import { Arrow } from "react-konva";
import { plannerTheme } from "../../theme/plannerTheme";
import { resolvePanelLocalArrowAzimuth } from "./moduleSlope";

function ModuleSlopeArrow({
  id,
  cx,
  cy,
  wPx,
  hPx,
  panelRotationDeg,
  opacity = 0.58,
  color = plannerTheme.textMuted,
}: {
  id?: string;
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  panelRotationDeg: number;
  opacity?: number;
  color?: string;
}) {
  const azimuthDeg = resolvePanelLocalArrowAzimuth(panelRotationDeg);
  if (azimuthDeg === undefined) return null;
  const length = Math.max(4, Math.min(18, Math.min(wPx, hPx) * 0.55));
  const half = length / 2;
  const pointer = Math.max(2, Math.min(4, length * 0.3));
  return (
    <Arrow
      id={id}
      x={cx}
      y={cy}
      points={[0, half, 0, -half]}
      rotation={azimuthDeg}
      stroke={color}
      fill={color}
      strokeWidth={Math.max(0.65, Math.min(1.15, length * 0.08))}
      pointerLength={pointer}
      pointerWidth={pointer}
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

export default React.memo(ModuleSlopeArrow);
