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
import ModuleSlopeArrow from "../panels/ModuleSlopeArrow";
import {
  resolveModuleDownhillAzimuth,
  selectModuleSlopeArrowIds,
} from "../panels/moduleSlope";

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

export default function AdvancedPreviewLayer({
  canvasRotationDeg = 0,
}: {
  canvasRotationDeg?: number;
}) {
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const roof = usePlannerV2Store((state) => state.layers.find((item) => item.id === state.selectedId));
  const draft = usePlannerV2Store((state) => state.selectedId ? state.roofPlanningDrafts[state.selectedId] : undefined);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);
  const showFieldDimensions = usePlannerV2Store((state) => state.ui.showFieldDimensions);

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
  const slopeArrowIds = React.useMemo(
    () => selectModuleSlopeArrowIds({
      modules: (preview?.modules ?? []).map((module) => ({
        id: `${module.blockKey}:${module.slotIndex}`,
        cx: module.cx,
        cy: module.cy,
        hPx: module.hPx,
      })),
      rowAxisCanvasDeg: preview?.modules[0]?.angleDeg ?? 0,
    }),
    [preview],
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
  const previewBlockCenters = new Map(
    (preview?.blocks ?? []).map((block) => [block.blockKey, centroid(block.footprintPx)]),
  );

  return (
    <Group listening={false}>
      {preview && preview.blocks.length > 0 && (
        <Group listening={false}>
          {preview.blocks.map((block) => {
            const points = block.footprintPx.flatMap((point) => [point.x, point.y]);
            const [a, b, c, d] = block.footprintPx;
            return (
              <Group key={block.blockKey} listening={false}>
                <Line
                  points={points}
                  closed
                  stroke={block.valid ? plannerTheme.primary : "#ef4444"}
                  strokeWidth={1.2}
                  dash={block.valid ? [5, 3] : [3, 2]}
                  fill={block.valid ? "rgba(59, 130, 246, 0.05)" : "rgba(239, 68, 68, 0.08)"}
                />
                {isOpposingSystem && a && b && c && d && (
                  <Line
                    points={[
                      (a.x + d.x) / 2,
                      (a.y + d.y) / 2,
                      (b.x + c.x) / 2,
                      (b.y + c.y) / 2,
                    ]}
                    stroke={block.valid ? plannerTheme.primary : "#ef4444"}
                    strokeWidth={0.8}
                    opacity={0.75}
                  />
                )}
              </Group>
            );
          })}
          {preview.modules.map((module) => {
            const blockCenter = previewBlockCenters.get(module.blockKey) ?? {
              x: module.cx,
              y: module.cy,
            };
            const downhillAzimuthDeg = resolveModuleDownhillAzimuth(isOpposingSystem
              ? {
                  kind: "flat-opposing",
                  blockCenterPx: blockCenter,
                  moduleCenterPx: { x: module.cx, y: module.cy },
                  moduleFaceAzimuthDeg: module.faceAzimuthDeg,
                }
              : {
                  kind: "flat-south",
                  moduleFaceAzimuthDeg: module.faceAzimuthDeg,
                });
            return (
              <Group key={`${module.blockKey}:${module.slotIndex}`} listening={false}>
                <Line
                  points={module.footprintPx.flatMap((point) => [point.x, point.y])}
                  closed
                  stroke={plannerTheme.panelStroke}
                  strokeWidth={0.7}
                  fill="rgba(30, 64, 175, 0.45)"
                />
                {slopeArrowIds.has(`${module.blockKey}:${module.slotIndex}`) && (
                  <ModuleSlopeArrow
                    cx={module.cx}
                    cy={module.cy}
                    wPx={module.wPx}
                    hPx={module.hPx}
                    azimuthDeg={downhillAzimuthDeg}
                  />
                )}
              </Group>
            );
          })}
          {preview.montageFields.map((field, fieldIndex) => {
            const labelPoint = centroid(field.outlinePx);
            return (
              <Group key={field.fieldKey} listening={false}>
                <Line
                  points={field.outlinePx.flatMap((point) => [point.x, point.y])}
                  closed
                  stroke={plannerTheme.primary}
                  strokeWidth={1.6}
                  dash={[9, 5]}
                  opacity={0.72}
                />
                <Text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  offsetX={showFieldDimensions ? 38 : 4}
                  offsetY={showFieldDimensions ? 7 : 4}
                  rotation={-canvasRotationDeg}
                  text={showFieldDimensions
                    ? `F${fieldIndex + 1} · ${field.longSideSizeM.toFixed(2)} × ${field.railSizeM.toFixed(2)} m`
                    : `F${fieldIndex + 1}`}
                  fill={plannerTheme.primary}
                  fontSize={showFieldDimensions ? 8 : 9}
                  fontStyle="bold"
                />
              </Group>
            );
          })}
          {preview.thermalFields.map((field, fieldIndex) => {
            const labelPoint = centroid(field.outlinePx);
            return (
              <Group key={field.thermalFieldKey} listening={false}>
                <Line
                  points={field.outlinePx.flatMap((point) => [point.x, point.y])}
                  closed
                  stroke="#f59e0b"
                  strokeWidth={1.1}
                  dash={[3, 4]}
                  opacity={0.72}
                />
                <Text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  offsetX={showFieldDimensions ? 42 : 5}
                  offsetY={showFieldDimensions ? -8 : -7}
                  rotation={-canvasRotationDeg}
                  text={showFieldDimensions
                    ? `T${fieldIndex + 1} · ${field.rowDirectionSizeM.toFixed(2)} × ${field.columnDirectionSizeM.toFixed(2)} m`
                    : `T${fieldIndex + 1}`}
                  fill="#f59e0b"
                  fontSize={showFieldDimensions ? 8 : 9}
                  fontStyle="bold"
                />
              </Group>
            );
          })}
        </Group>
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
