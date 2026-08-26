"use client";

import React from "react";
import { Arrow, Group, Line, Text } from "react-konva";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import type { Pt } from "@/types/planner";
import { geographicAzimuthToCartesianDeg } from "@/lib/planning-core/geometry-v2";
import { plannerTheme } from "../../theme/plannerTheme";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import { computeAdvancedPlanningPreview } from "./advancedPlanningApplication";

function centroid(points: Pt[]): Pt {
  const count = Math.max(1, points.length);
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
}

function azimuthVector(azimuthDeg: number, length: number): Pt {
  const radians = (geographicAzimuthToCartesianDeg(azimuthDeg) * Math.PI) / 180;
  return { x: Math.cos(radians) * length, y: -Math.sin(radians) * length };
}

function DirectionArrow({
  origin,
  azimuthDeg,
  color,
  label,
  offset = 0,
}: {
  origin: Pt;
  azimuthDeg: number;
  color: string;
  label: string;
  offset?: number;
}) {
  const vector = azimuthVector(azimuthDeg, 28);
  return (
    <Group x={origin.x + offset} y={origin.y + offset} listening={false}>
      <Arrow
        points={[0, 0, vector.x, vector.y]}
        stroke={color}
        fill={color}
        strokeWidth={1.5}
        pointerLength={5}
        pointerWidth={5}
      />
      <Text x={vector.x + 3} y={vector.y - 4} text={label} fill={color} fontSize={7} />
    </Group>
  );
}

export default function AdvancedPreviewLayer() {
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const roof = usePlannerV2Store((state) => state.layers.find((item) => item.id === state.selectedId));
  const draft = usePlannerV2Store((state) => state.selectedId ? state.roofPlanningDrafts[state.selectedId] : undefined);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);

  const persisted = resolveSurfacePlanning(roof?.surfacePlanning);
  const config: AdvancedSurfacePlanningV1 | undefined =
    draft?.targetMode === "advanced"
      ? draft.config
      : !draft && persisted.status === "supported-advanced"
        ? persisted.config
        : undefined;
  const preview = React.useMemo(
    () =>
      roof && config && draft?.targetMode === "advanced"
        ? computeAdvancedPlanningPreview({ roof, config, mppImage: mppImage ?? 0, zones, snowGuards })
        : null,
    [config, draft?.targetMode, mppImage, roof, snowGuards, zones],
  );

  if (!selectedId || !roof || !config) return null;
  const center = centroid(roof.points);
  const system = config.advanced.system;
  const primaryAzimuth = system.systemId === K2_S_DOME_SYSTEM_ID
    ? system.faceAzimuthDeg
    : system.systemId === K2_D_DOME_SYSTEM_ID
      ? system.primaryFaceAzimuthDeg
      : system.systemId === GENERIC_SOUTH_SYSTEM_ID
        ? system.faceAzimuthDeg
        : system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
          ? system.primaryFaceAzimuthDeg
          : undefined;
  const isOpposingSystem =
    system.systemId === K2_D_DOME_SYSTEM_ID ||
    system.systemId === GENERIC_EAST_WEST_SYSTEM_ID;

  return (
    <Group listening={false}>
      {preview?.valid && (
        <Group listening={false}>
          {preview.blocks.map((block) => {
            const points = block.footprintPx.flatMap((point) => [point.x, point.y]);
            const [a, b, c, d] = block.footprintPx;
            return (
              <Group key={block.blockKey} listening={false}>
                <Line
                  points={points}
                  closed
                  stroke={plannerTheme.primary}
                  strokeWidth={1.2}
                  dash={[5, 3]}
                  fill="rgba(59, 130, 246, 0.05)"
                />
                {isOpposingSystem && a && b && c && d && (
                  <Line
                    points={[
                      (a.x + d.x) / 2,
                      (a.y + d.y) / 2,
                      (b.x + c.x) / 2,
                      (b.y + c.y) / 2,
                    ]}
                    stroke={plannerTheme.primary}
                    strokeWidth={0.8}
                    opacity={0.75}
                  />
                )}
              </Group>
            );
          })}
          {preview.modules.map((module) => (
            <Line
              key={`${module.blockKey}:${module.slotIndex}`}
              points={module.footprintPx.flatMap((point) => [point.x, point.y])}
              closed
              stroke={plannerTheme.panelStroke}
              strokeWidth={0.7}
              fill="rgba(30, 64, 175, 0.45)"
            />
          ))}
        </Group>
      )}

      {typeof config.surface.fallAzimuthDeg === "number" && (
        <DirectionArrow
          origin={center}
          azimuthDeg={config.surface.fallAzimuthDeg}
          color="#f59e0b"
          label="Dachgefälle"
          offset={-8}
        />
      )}
      {typeof primaryAzimuth === "number" && (
        <>
          <DirectionArrow origin={center} azimuthDeg={primaryAzimuth} color="#22c55e" label="Modul" offset={8} />
          {isOpposingSystem && (
            <DirectionArrow origin={center} azimuthDeg={primaryAzimuth + 180} color="#22c55e" label="Modul" offset={8} />
          )}
        </>
      )}
    </Group>
  );
}
