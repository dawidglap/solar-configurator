"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";
import { getCanonicalRoofEdges, resolveRoofReferenceEdgeIndex } from "@/lib/planning-core/geometry-v2";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { plannerTheme } from "../theme/plannerTheme";

function isPointInsidePolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) /
        (previous.y - current.y || 1e-9) + current.x
    ) inside = !inside;
  }
  return inside;
}

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
  const label = (selectedZone
    ? "Bezugskante"
    : roofKind === "pitched" ? "First" : "Referenzkante").toUpperCase();
  const leftNormal = { x: -edge.direction.y, y: edge.direction.x };
  // A tiny world-space probe identifies the polygon exterior independently
  // from viewport zoom; the visible label offset below remains screen-scaled.
  const sampleDistance = 0.75;
  const leftSample = {
    x: edge.midpoint.x + leftNormal.x * sampleDistance,
    y: edge.midpoint.y + leftNormal.y * sampleDistance,
  };
  const outward = isPointInsidePolygon(leftSample, roof.points)
    ? { x: -leftNormal.x, y: -leftNormal.y }
    : leftNormal;
  const labelDistance = 22 * inverseScale;
  const labelCenter = {
    x: edge.midpoint.x + outward.x * labelDistance,
    y: edge.midpoint.y + outward.y * labelDistance,
  };
  const labelWidth = Math.max(48, label.length * 7.4) * inverseScale;
  const labelHeight = 19 * inverseScale;
  return (
    <Group listening={false}>
      <Line
        points={[edge.start.x, edge.start.y, edge.end.x, edge.end.y]}
        stroke={plannerTheme.primary}
        strokeWidth={3 * inverseScale}
        opacity={0.95}
        lineCap="round"
      />
      <Rect
        x={labelCenter.x - labelWidth / 2}
        y={labelCenter.y - labelHeight / 2}
        width={labelWidth}
        height={labelHeight}
        fill="rgba(10, 20, 28, 0.88)"
        stroke={plannerTheme.primary}
        strokeWidth={1 * inverseScale}
        cornerRadius={5 * inverseScale}
        listening={false}
      />
      <Text
        x={labelCenter.x - labelWidth / 2}
        y={labelCenter.y - 6 * inverseScale}
        width={labelWidth}
        text={label}
        align="center"
        fill={plannerTheme.textLight}
        fontSize={12 * inverseScale}
        fontStyle="bold"
        listening={false}
      />
    </Group>
  );
}
