"use client";

import React from "react";
import { Group, Line } from "react-konva";

import { resolveCanonicalRoofReferenceEdge } from "@/lib/planning-core/geometry-v2";
import type { Pt } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";

type Props = {
  points: readonly Pt[];
  roofKind: "pitched" | "flat" | "green";
  referenceEdgeIndex?: number;
  scale: number;
  subdued?: boolean;
};

/** Selected-roof semantic edge accent. Labels stay in the normal dimension system. */
export default function RoofReferenceEdgeLayer({
  points,
  roofKind,
  referenceEdgeIndex,
  scale,
  subdued = false,
}: Props) {
  if (roofKind === "green") return null;
  const edge = resolveCanonicalRoofReferenceEdge({
    points,
    roofKind,
    requestedIndex: referenceEdgeIndex,
  });
  if (!edge) return null;

  const inverseScale = 1 / Math.max(scale, 0.01);
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
    </Group>
  );
}
