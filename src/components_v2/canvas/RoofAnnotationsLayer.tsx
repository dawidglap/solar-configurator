"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";

import {
  computeUsableRoof,
  imagePolygonToMetric,
  metricPolygonToImage,
} from "@/lib/planning-core/geometry-v2";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import type { Pt } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { plannerTheme } from "../theme/plannerTheme";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import RoofAzimuthArrows from "./RoofAzimuthArrows";
import { RoofMarginBand } from "../modules/panels/RoofMarginBand";
import {
  buildRoofAnnotationModel,
  resolveScreenReadableAnnotationRotation,
} from "./roofAnnotationModel";
import RoofReferenceEdgeLayer from "./RoofReferenceEdgeLayer";
import {
  getTransientRoofAnnotationPoints,
  subscribeTransientRoofAnnotationPoints,
} from "./performance/transientRoofAnnotations";

const MODULE_EDGE_PILL_SCALE = 1.25;
const MODULE_EDGE_PILL_FONT_SIZE = 10.5 * MODULE_EDGE_PILL_SCALE;
const MODULE_EDGE_PILL_MIN_WIDTH = 84 * MODULE_EDGE_PILL_SCALE;
const MODULE_EDGE_PILL_CHAR_WIDTH = 6.15 * MODULE_EDGE_PILL_SCALE;
const MODULE_EDGE_PILL_PADDING_X = 9 * MODULE_EDGE_PILL_SCALE;
const MODULE_EDGE_PILL_HEIGHT = 24 * MODULE_EDGE_PILL_SCALE;
const MODULE_EDGE_PILL_RADIUS = 7 * MODULE_EDGE_PILL_SCALE;

function useTransientPoints(roofId: string): readonly Pt[] | null {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => subscribeTransientRoofAnnotationPoints(roofId, listener),
      [roofId],
    ),
    React.useCallback(() => getTransientRoofAnnotationPoints(roofId), [roofId]),
    () => null,
  );
}

type RoofAnnotationsLayerProps = {
  canvasRotationDeg?: number;
};

export default function RoofAnnotationsLayer({
  canvasRotationDeg = 0,
}: RoofAnnotationsLayerProps) {
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const selectedZone = usePlannerV2Store((state) =>
    state.zones.find((zone) => zone.id === state.selectedZoneId),
  );
  const roofId = selectedZone?.roofId ?? selectedId;
  const roof = usePlannerV2Store((state) => state.layers.find((item) => item.id === roofId));
  const step = usePlannerV2Store((state) => state.step);
  const scale = usePlannerV2Store((state) => state.view.scale || state.view.fitScale || 1);
  const view = usePlannerV2Store((state) => state.view);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage ?? 0);
  const globalMarginM = usePlannerV2Store((state) => state.modules.marginM);
  const draft = usePlannerV2Store((state) => roofId ? state.roofPlanningDrafts[roofId] : undefined);
  const transientPoints = useTransientPoints(roofId ?? "");

  if (!roofId || !roof || !mppImage || (step !== "building" && step !== "modules")) return null;
  const points = transientPoints ?? roof.points;
  const persisted = resolveSurfacePlanning(roof.surfacePlanning);
  const advancedConfig = draft?.targetMode === "advanced"
    ? draft.config
    : !draft && persisted.status === "supported-advanced"
      ? persisted.config
      : undefined;
  const roofKind = roof.roofKind ?? (draft?.targetMode === "standard"
    ? "pitched"
    : advancedConfig?.surface.kind ?? "pitched");
  const tiltDeg = roofKind === "flat"
    ? 0
    : advancedConfig?.surface.slopeDeg ?? roof.tiltDeg;
  const fallAzimuthDeg = advancedConfig?.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(roof);
  const showRoofFallArrow =
    step === "building" &&
    roofKind === "pitched" &&
    typeof fallAzimuthDeg === "number" &&
    (tiltDeg ?? 0) > 0.05;
  const marginM = advancedConfig?.advanced.layout.marginM
    ?? (draft?.targetMode === "standard" ? draft.modules.marginM : undefined)
    ?? resolveRoofEdgeMarginM(roof, globalMarginM);
  const requestedReference = selectedZone?.edgeReference?.edgeIndex ?? roof.referenceEdgeIndex;
  const model = buildRoofAnnotationModel({
    points,
    mppImage,
    roofKind,
    tiltDeg,
    fallAzimuthDeg,
    referenceEdgeIndex: requestedReference,
    ...(selectedZone ? { referenceLabel: "BEZUGSKANTE" as const } : {}),
  });
  const inverseScale = 1 / Math.max(scale, 0.01);
  const useModuleEdgePills = step === "modules" && !selectedZone;
  const offset = (useModuleEdgePills ? 24 : 18) * inverseScale;
  const adapter = { mppImage, metricOriginPx: { x: 0, y: 0 } };
  const usableRoof = marginM > 0
    ? computeUsableRoof({
        roofPolygonM: imagePolygonToMetric([...points], adapter),
        marginM,
      })
    : null;
  const usableComponentsPx = usableRoof?.status === "valid"
    ? usableRoof.components.map((component) => metricPolygonToImage(component, adapter))
    : [];
  return (
    <Group id={`roof-annotation-transform-${roof.id}`} listening={false}>
      {marginM > 0 && (
        <Group listening={false}>
          <RoofMarginBand
            polygon={[...points]}
            marginPx={marginM / mppImage}
            innerPolygons={usableComponentsPx}
            scale={scale}
          />
        </Group>
      )}

      {showRoofFallArrow && (
        <RoofAzimuthArrows
          points={[...points]}
          view={view}
          azimuthDeg={fallAzimuthDeg}
          tiltDeg={tiltDeg}
          flatEpsDeg={0.05}
          color={plannerTheme.primary}
          opacity={0.86}
          stepPx={72}
          lenPx={30}
        />
      )}

      {model.edges.map((edge) => {
        const labelPoint = {
          x: edge.midpoint.x + edge.outward.x * offset,
          y: edge.midpoint.y + edge.outward.y * offset,
        };
        const tick = 3.5 * inverseScale;
        const fontSize = (useModuleEdgePills ? MODULE_EDGE_PILL_FONT_SIZE : 8.5) * inverseScale;
        const lineStart = {
          x: edge.start.x + edge.outward.x * offset,
          y: edge.start.y + edge.outward.y * offset,
        };
        const lineEnd = {
          x: edge.end.x + edge.outward.x * offset,
          y: edge.end.y + edge.outward.y * offset,
        };
        const displayLabel = edge.label;
        const pillWidth = Math.max(
          MODULE_EDGE_PILL_MIN_WIDTH,
          displayLabel.length * MODULE_EDGE_PILL_CHAR_WIDTH + MODULE_EDGE_PILL_PADDING_X * 2,
        ) * inverseScale;
        const pillHeight = MODULE_EDGE_PILL_HEIGHT * inverseScale;
        const labelRotation = useModuleEdgePills
          ? resolveScreenReadableAnnotationRotation(edge.readableAngleDeg, canvasRotationDeg)
          : edge.readableAngleDeg;
        return (
          <Group key={edge.edgeIndex} listening={false}>
            {edge.isReference && selectedZone && (
              <Line
                points={[edge.start.x, edge.start.y, edge.end.x, edge.end.y]}
                stroke={plannerTheme.primary}
                strokeWidth={3 * inverseScale}
                opacity={0.92}
                lineCap="round"
                listening={false}
              />
            )}
            <Line
              points={[lineStart.x, lineStart.y, lineEnd.x, lineEnd.y]}
              stroke={plannerTheme.textLight}
              strokeWidth={0.75 * inverseScale}
              opacity={0.86}
              listening={false}
            />
            {[lineStart, lineEnd].map((point, index) => (
              <Line
                key={index}
                points={[
                  point.x - edge.outward.x * tick,
                  point.y - edge.outward.y * tick,
                  point.x + edge.outward.x * tick,
                  point.y + edge.outward.y * tick,
                ]}
                stroke={plannerTheme.textLight}
                strokeWidth={0.75 * inverseScale}
                listening={false}
              />
            ))}
            {useModuleEdgePills ? (
              <Group
                x={labelPoint.x}
                y={labelPoint.y}
                rotation={labelRotation}
                listening={false}
              >
                <Rect
                  x={-pillWidth / 2}
                  y={-pillHeight / 2}
                  width={pillWidth}
                  height={pillHeight}
                  fill="#FFFFFF"
                  cornerRadius={MODULE_EDGE_PILL_RADIUS * inverseScale}
                  shadowColor="#000000"
                  shadowBlur={4 * inverseScale}
                  shadowOffsetY={1.5 * inverseScale}
                  shadowOpacity={0.26}
                  listening={false}
                />
                <Text
                  x={-pillWidth / 2 + MODULE_EDGE_PILL_PADDING_X * inverseScale}
                  y={-pillHeight / 2}
                  width={pillWidth - MODULE_EDGE_PILL_PADDING_X * 2 * inverseScale}
                  height={pillHeight}
                  text={displayLabel}
                  fill="#000000"
                  fontSize={fontSize}
                  fontStyle="600"
                  align="center"
                  verticalAlign="middle"
                  listening={false}
                />
              </Group>
            ) : (
              <Text
                x={labelPoint.x}
                y={labelPoint.y}
                text={displayLabel}
                rotation={labelRotation}
                offsetX={displayLabel.length * fontSize * 0.27}
                offsetY={fontSize + 1.5 * inverseScale}
                fill={edge.isReference && selectedZone ? plannerTheme.primary : plannerTheme.textLight}
                fontSize={fontSize}
                fontStyle={edge.isReference && selectedZone ? "bold" : "normal"}
                shadowColor="#000"
                shadowBlur={2 * inverseScale}
                shadowOpacity={0.85}
                listening={false}
              />
            )}
          </Group>
        );
      })}
      {!selectedZone && (
        <RoofReferenceEdgeLayer
          points={points}
          roofKind={roofKind}
          referenceEdgeIndex={roof.referenceEdgeIndex}
          scale={scale}
          subdued={step === "modules"}
        />
      )}
    </Group>
  );
}
