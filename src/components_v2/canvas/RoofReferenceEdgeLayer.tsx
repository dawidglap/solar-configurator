"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";

import type { Pt } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import { buildRoofReferenceEdgePresentation } from "./roofReferenceEdgePresentation";

type Props = {
  points: readonly Pt[];
  roofKind: "pitched" | "flat" | "green";
  referenceEdgeIndex?: number;
  scale: number;
  canvasRotationDeg: number;
  subdued?: boolean;
};

/** Selected-roof semantic highlight. It is derived and never persisted. */
export default function RoofReferenceEdgeLayer({
  points,
  roofKind,
  referenceEdgeIndex,
  scale,
  canvasRotationDeg,
  subdued = false,
}: Props) {
  const presentation = buildRoofReferenceEdgePresentation({
    points,
    roofKind,
    referenceEdgeIndex,
    scale,
    canvasRotationDeg,
  });
  if (!presentation) return null;

  const { edge, label, center, screenRotationDeg, widthPx, heightPx, fontSizePx } = presentation;
  const inverseScale = 1 / Math.max(scale, 0.01);
  const labelWidth = widthPx * inverseScale;
  const labelHeight = heightPx * inverseScale;
  const opacity = subdued ? 0.86 : 1;

  return (
    <Group listening={false} opacity={opacity}>
      <Line
        points={[edge.start.x, edge.start.y, edge.end.x, edge.end.y]}
        stroke={plannerTheme.referenceEdgeGlow}
        strokeWidth={(subdued ? 6 : 7) * inverseScale}
        opacity={0.42}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[edge.start.x, edge.start.y, edge.end.x, edge.end.y]}
        stroke={plannerTheme.referenceEdge}
        strokeWidth={(subdued ? 2.5 : 3.5) * inverseScale}
        lineCap="round"
        listening={false}
      />
      <Group
        x={center.x}
        y={center.y}
        rotation={screenRotationDeg}
        listening={false}
      >
        <Rect
          x={-labelWidth / 2}
          y={-labelHeight / 2}
          width={labelWidth}
          height={labelHeight}
          fill="rgba(255, 255, 255, 0.96)"
          stroke={plannerTheme.referenceEdge}
          strokeWidth={1.25 * inverseScale}
          cornerRadius={labelHeight / 2}
          shadowColor="#000"
          shadowBlur={6 * inverseScale}
          shadowOpacity={0.42}
          shadowOffsetY={1.5 * inverseScale}
          listening={false}
        />
        <Text
          x={-labelWidth / 2}
          y={-(fontSizePx * 0.58) * inverseScale}
          width={labelWidth}
          text={label}
          align="center"
          fill="#111827"
          fontSize={fontSizePx * inverseScale}
          fontStyle="bold"
          listening={false}
        />
      </Group>
    </Group>
  );
}
