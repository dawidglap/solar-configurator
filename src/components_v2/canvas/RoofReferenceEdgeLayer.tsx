"use client";

import React from "react";
import { Group, Line, Text } from "react-konva";
import { getCanonicalRoofEdges, resolveRoofReferenceEdgeIndex } from "@/lib/planning-core/geometry-v2";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { plannerTheme } from "../theme/plannerTheme";

export default function RoofReferenceEdgeLayer() {
  const selectedZone = usePlannerV2Store((state) =>
    state.zones.find((item) => item.id === state.selectedZoneId),
  );
  const roof = usePlannerV2Store((state) => state.layers.find((item) =>
    item.id === (selectedZone?.roofId ?? state.selectedId)),
  );
  const scale = usePlannerV2Store((state) => state.view.scale || state.view.fitScale || 1);
  const step = usePlannerV2Store((state) => state.step);
  const planning = resolveSurfacePlanning(roof?.surfacePlanning);
  if (!roof || step !== "building") return null;
  const roofKind = planning.status === "supported-advanced"
    ? planning.config.surface.kind
    : "pitched";
  const edgeIndex = resolveRoofReferenceEdgeIndex({
    points: roof.points,
    requestedIndex: selectedZone?.edgeReference?.edgeIndex ?? roof.referenceEdgeIndex,
    roofKind,
  });
  const edge = edgeIndex == null ? undefined : getCanonicalRoofEdges(roof.points)[edgeIndex];
  if (!edge) return null;
  const inverseScale = 1 / Math.max(scale, 0.01);
  const label = selectedZone
    ? "Bezugskante"
    : roofKind === "pitched" ? "First" : "Referenzkante";
  return (
    <Group listening={false}>
      <Line
        points={[edge.start.x, edge.start.y, edge.end.x, edge.end.y]}
        stroke={plannerTheme.primary}
        strokeWidth={3 * inverseScale}
        opacity={0.95}
        lineCap="round"
      />
      <Text
        x={edge.midpoint.x}
        y={edge.midpoint.y - 11 * inverseScale}
        text={label}
        fill={plannerTheme.primary}
        fontSize={9 * inverseScale}
        fontStyle="bold"
        offsetX={label.length * 2.2 * inverseScale}
      />
    </Group>
  );
}
