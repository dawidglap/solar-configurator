"use client";

import React from "react";
import { Group, Line, Text } from "react-konva";

import { analyzeRectangularRoof, getCanonicalRoofVertices } from "@/lib/planning-core/geometry-v2";
import type { Pt, RoofArea } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import { usePlannerV2Store } from "../state/plannerV2Store";

function dimensionGeometry(input: {
  points: readonly Pt[];
  edgeIndex: number;
  center: Pt;
  offsetPx: number;
}) {
  const start = input.points[input.edgeIndex];
  const end = input.points[(input.edgeIndex + 1) % input.points.length];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  let normal = { x: -dy / length, y: dx / length };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if ((midpoint.x - input.center.x) * normal.x + (midpoint.y - input.center.y) * normal.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  const offset = { x: normal.x * input.offsetPx, y: normal.y * input.offsetPx };
  const a = { x: start.x + offset.x, y: start.y + offset.y };
  const b = { x: end.x + offset.x, y: end.y + offset.y };
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return { a, b, midpoint: { x: midpoint.x + offset.x, y: midpoint.y + offset.y }, normal, angle };
}

function Dimension({
  roof,
  edgeIndex,
  center,
  label,
  scale,
}: {
  roof: RoofArea;
  edgeIndex: number;
  center: Pt;
  label: string;
  scale: number;
}) {
  const inverseScale = 1 / Math.max(scale, 0.01);
  const geometry = dimensionGeometry({
    points: roof.points,
    edgeIndex,
    center,
    offsetPx: 13 * inverseScale,
  });
  const tick = 4 * inverseScale;
  const fontSize = 9 * inverseScale;
  return (
    <Group listening={false}>
      <Line
        points={[geometry.a.x, geometry.a.y, geometry.b.x, geometry.b.y]}
        stroke={plannerTheme.textLight}
        strokeWidth={0.8 * inverseScale}
        opacity={0.9}
      />
      {[geometry.a, geometry.b].map((point, index) => (
        <Line
          key={index}
          points={[
            point.x - geometry.normal.x * tick,
            point.y - geometry.normal.y * tick,
            point.x + geometry.normal.x * tick,
            point.y + geometry.normal.y * tick,
          ]}
          stroke={plannerTheme.textLight}
          strokeWidth={0.8 * inverseScale}
        />
      ))}
      <Text
        x={geometry.midpoint.x}
        y={geometry.midpoint.y}
        text={label}
        fontSize={fontSize}
        fill={plannerTheme.textLight}
        rotation={geometry.angle}
        offsetX={(label.length * fontSize * 0.28)}
        offsetY={fontSize + 2 * inverseScale}
        padding={2 * inverseScale}
        shadowColor="#000"
        shadowBlur={2 * inverseScale}
        shadowOpacity={0.8}
      />
    </Group>
  );
}

export default function RoofDimensionLabelsLayer() {
  const selectedRoof = usePlannerV2Store((state) =>
    state.layers.find((roof) => roof.id === state.selectedId),
  );
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const scale = usePlannerV2Store((state) => state.view.scale || state.view.fitScale || 1);
  const analysis = React.useMemo(
    () => analyzeRectangularRoof(selectedRoof?.points ?? [], mppImage ?? 0),
    [mppImage, selectedRoof?.points],
  );
  if (!selectedRoof || !analysis.supported) return null;
  const canonicalRoof = {
    ...selectedRoof,
    points: getCanonicalRoofVertices(selectedRoof.points).map(({ x, y }) => ({ x, y })),
  };
  return (
    <Group listening={false}>
      <Dimension
        roof={canonicalRoof}
        edgeIndex={analysis.dimensions.lengthEdgeIndex}
        center={analysis.dimensions.centerPx}
        label={`${analysis.dimensions.lengthM.toFixed(2)} m`}
        scale={scale}
      />
      <Dimension
        roof={canonicalRoof}
        edgeIndex={analysis.dimensions.widthEdgeIndex}
        center={analysis.dimensions.centerPx}
        label={`${analysis.dimensions.widthM.toFixed(2)} m`}
        scale={scale}
      />
    </Group>
  );
}
