"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";

import { resolveCanonicalRoofReferenceEdge } from "@/lib/planning-core/geometry-v2";
import type { Pt } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";

function isPointInsidePolygon(point: Pt, polygon: readonly Pt[]) {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y || 1e-9) +
          current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

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
  const edge = resolveCanonicalRoofReferenceEdge({
    points,
    requestedIndex: referenceEdgeIndex,
    roofKind,
  });
  if (!edge || roofKind === "green") return null;

  const inverseScale = 1 / Math.max(scale, 0.01);
  const leftNormal = { x: -edge.direction.y, y: edge.direction.x };
  const leftSample = {
    x: edge.midpoint.x + leftNormal.x * 0.75,
    y: edge.midpoint.y + leftNormal.y * 0.75,
  };
  const outward = isPointInsidePolygon(leftSample, points)
    ? { x: -leftNormal.x, y: -leftNormal.y }
    : leftNormal;
  const label = roofKind === "pitched" ? "FIRST" : "REFERENZKANTE";
  const labelCenter = {
    x: edge.midpoint.x + outward.x * 38 * inverseScale,
    y: edge.midpoint.y + outward.y * 38 * inverseScale,
  };
  const labelWidth = Math.max(58, label.length * 8 + 20) * inverseScale;
  const labelHeight = 22 * inverseScale;
  const opacity = subdued ? 0.78 : 1;

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
        x={labelCenter.x}
        y={labelCenter.y}
        rotation={-canvasRotationDeg}
        listening={false}
      >
        <Rect
          x={-labelWidth / 2}
          y={-labelHeight / 2}
          width={labelWidth}
          height={labelHeight}
          fill="rgba(11, 16, 28, 0.94)"
          stroke={plannerTheme.referenceEdge}
          strokeWidth={1.25 * inverseScale}
          cornerRadius={7 * inverseScale}
          shadowColor={plannerTheme.referenceEdgeGlow}
          shadowBlur={5 * inverseScale}
          shadowOpacity={0.65}
          listening={false}
        />
        <Text
          x={-labelWidth / 2}
          y={-6.5 * inverseScale}
          width={labelWidth}
          text={label}
          align="center"
          fill={plannerTheme.textLight}
          fontSize={11 * inverseScale}
          fontStyle="bold"
          listening={false}
        />
      </Group>
    </Group>
  );
}
