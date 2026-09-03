"use client";

import React from "react";
import { Group, Line, Text } from "react-konva";

import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import type { Pt } from "@/types/planner";
import { plannerTheme } from "../../theme/plannerTheme";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import { buildCommittedMontageFieldMeasurements } from "./committedMontageFieldMeasurements";

function centroid(points: Pt[]): Pt {
  const count = Math.max(1, points.length);
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
}

export default function CommittedMontageFieldDimensionsLayer() {
  const show = usePlannerV2Store((state) => state.ui.showFieldDimensions);
  const step = usePlannerV2Store((state) => state.step);
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const roof = usePlannerV2Store((state) =>
    state.layers.find((candidate) => candidate.id === state.selectedId),
  );
  const draft = usePlannerV2Store((state) =>
    state.selectedId ? state.roofPlanningDrafts[state.selectedId] : undefined,
  );
  const panels = usePlannerV2Store((state) => state.panels);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const persisted = React.useMemo(
    () => resolveSurfacePlanning(roof?.surfacePlanning),
    [roof?.surfacePlanning],
  );
  const fields = React.useMemo(
    () =>
      show && step === "modules" && selectedId && roof && !draft && mppImage &&
      persisted.status === "supported-advanced"
        ? buildCommittedMontageFieldMeasurements({
            roof,
            config: persisted.config,
            panels,
            mppImage,
          })
        : [],
    [draft, mppImage, panels, persisted, roof, selectedId, show, step],
  );

  if (!show || !fields.length) return null;
  return (
    <Group listening={false}>
      {fields.map((field, index) => {
        const center = centroid(field.outlinePx);
        const first = field.outlinePx[0];
        const second = field.outlinePx[1];
        const rotation = first && second
          ? (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI
          : 0;
        return (
          <Group key={field.fieldKey} listening={false}>
            <Line
              points={field.outlinePx.flatMap((point) => [point.x, point.y])}
              closed
              stroke={plannerTheme.primary}
              strokeWidth={1.6}
              dash={[9, 5]}
              opacity={0.78}
              listening={false}
            />
            <Text
              x={center.x}
              y={center.y}
              offsetX={38}
              offsetY={7}
              rotation={rotation}
              text={`F${index + 1} · ${field.longSideSizeM.toFixed(2)} × ${field.railSizeM.toFixed(2)} m`}
              fill={plannerTheme.primary}
              fontSize={8}
              fontStyle="bold"
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
