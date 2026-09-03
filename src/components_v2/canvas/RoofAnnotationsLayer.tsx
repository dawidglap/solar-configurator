"use client";

import React from "react";
import { Arrow, Group, Line, Text } from "react-konva";

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
import { buildRoofAnnotationModel } from "./roofAnnotationModel";
import {
  getTransientRoofAnnotationPoints,
  subscribeTransientRoofAnnotationPoints,
} from "./performance/transientRoofAnnotations";

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

function SmallFallArrow({ center, azimuthDeg, scale }: {
  center: Pt;
  azimuthDeg: number;
  scale: number;
}) {
  const radians = azimuthDeg * Math.PI / 180;
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) };
  const inverseScale = 1 / Math.max(scale, 0.01);
  const length = 20 * inverseScale;
  return (
    <Group listening={false}>
      <Arrow
        points={[
          center.x - direction.x * length / 2,
          center.y - direction.y * length / 2,
          center.x + direction.x * length / 2,
          center.y + direction.y * length / 2,
        ]}
        stroke={plannerTheme.primary}
        fill={plannerTheme.primary}
        strokeWidth={1.25 * inverseScale}
        pointerLength={5 * inverseScale}
        pointerWidth={5 * inverseScale}
        opacity={0.72}
        listening={false}
      />
      <Text
        x={center.x + direction.x * length / 2 + 4 * inverseScale}
        y={center.y + direction.y * length / 2 - 5 * inverseScale}
        text="GEFÄLLE"
        fill={plannerTheme.textLight}
        fontSize={8 * inverseScale}
        fontStyle="bold"
        listening={false}
      />
    </Group>
  );
}

export default function RoofAnnotationsLayer() {
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
  const roofKind = draft?.targetMode === "standard"
    ? "pitched"
    : advancedConfig?.surface.kind ?? "pitched";
  const tiltDeg = roofKind === "flat"
    ? 0
    : advancedConfig?.surface.slopeDeg ?? roof.tiltDeg;
  const fallAzimuthDeg = advancedConfig?.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(roof);
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
  const offset = 18 * inverseScale;
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

      {step === "building" && roofKind === "pitched" && typeof fallAzimuthDeg === "number" && (tiltDeg ?? 0) > 0.05 && (
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
      {step === "modules" && roofKind === "pitched" && typeof fallAzimuthDeg === "number" && (tiltDeg ?? 0) > 0.05 && (
        <SmallFallArrow center={model.center} azimuthDeg={fallAzimuthDeg} scale={scale} />
      )}

      {model.edges.map((edge) => {
        const labelPoint = {
          x: edge.midpoint.x + edge.outward.x * offset,
          y: edge.midpoint.y + edge.outward.y * offset,
        };
        const tick = 3.5 * inverseScale;
        const fontSize = 8.5 * inverseScale;
        const lineStart = {
          x: edge.start.x + edge.outward.x * offset,
          y: edge.start.y + edge.outward.y * offset,
        };
        const lineEnd = {
          x: edge.end.x + edge.outward.x * offset,
          y: edge.end.y + edge.outward.y * offset,
        };
        return (
          <Group key={edge.edgeIndex} listening={false}>
            {edge.isReference && (
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
            <Text
              x={labelPoint.x}
              y={labelPoint.y}
              text={edge.label}
              rotation={edge.readableAngleDeg}
              offsetX={edge.label.length * fontSize * 0.27}
              offsetY={fontSize + 1.5 * inverseScale}
              fill={edge.isReference ? plannerTheme.primary : plannerTheme.textLight}
              fontSize={fontSize}
              fontStyle={edge.isReference ? "bold" : "normal"}
              shadowColor="#000"
              shadowBlur={2 * inverseScale}
              shadowOpacity={0.85}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
