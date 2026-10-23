"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";

import {
  computeUsableRoof,
  imagePolygonToMetric,
  metricPolygonToImage,
} from "@/lib/planning-core/geometry-v2";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import {
  resolveRoofEdgeMarginM,
  resolveRoofEdgeMarginsM,
} from "@/lib/planning/roofProperties";
import type { Pt } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { plannerTheme } from "../theme/plannerTheme";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import RoofAzimuthArrows from "./RoofAzimuthArrows";
import { RoofMarginBand } from "../modules/panels/RoofMarginBand";
import {
  buildRoofAnnotationModel,
  formatRoofEdgeLengthM,
  resolveScreenReadableAnnotationRotation,
  type RoofEdgeAnnotation,
} from "./roofAnnotationModel";
import RoofReferenceEdgeLayer from "./RoofReferenceEdgeLayer";
import {
  getTransientRoofAnnotationPoints,
  subscribeTransientRoofAnnotationPoints,
} from "./performance/transientRoofAnnotations";
import { shouldShowRoofLabels } from "./roofLabelVisibility";

const EDGE_PILL_FONT_SIZE = 10;
const EDGE_PILL_MIN_WIDTH = 26;
const EDGE_PILL_CHAR_WIDTH = 6;
const EDGE_PILL_PADDING_X = 7;
const EDGE_PILL_HEIGHT = 20;
const EDGE_PILL_RADIUS = 6;

function edgeDisplayLabel(edge: RoofEdgeAnnotation): string {
  return edge.isReference ? edge.semanticLabel : `K${edge.edgeIndex + 1}`;
}

function edgeTooltipLabel(edge: RoofEdgeAnnotation): string {
  const semanticSuffix = edge.isReference ? ` · ${edge.semanticLabel}` : "";
  return `Kante ${edge.edgeIndex + 1} · ${formatRoofEdgeLengthM(edge.lengthM)}${semanticSuffix}`;
}

function EdgeHud({
  edges,
  inverseScale,
  offset,
  canvasRotationDeg,
}: {
  edges: readonly RoofEdgeAnnotation[];
  inverseScale: number;
  offset: number;
  canvasRotationDeg: number;
}) {
  const groupRef = React.useRef<Konva.Group>(null);
  const [hoveredEdgeIndex, setHoveredEdgeIndex] = React.useState<number>();

  React.useEffect(() => {
    const group = groupRef.current;
    const stage = group?.getStage();
    const container = stage?.container();
    if (!group || !stage || !container) return;

    const onPointerMove = (event: PointerEvent) => {
      stage.setPointersPositions(event);
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        setHoveredEdgeIndex(undefined);
        return;
      }
      const local = group.getAbsoluteTransform().copy().invert().point(pointer);
      const hovered = edges.find((edge) => {
        const label = edgeDisplayLabel(edge);
        const center = {
          x: edge.midpoint.x + edge.outward.x * offset,
          y: edge.midpoint.y + edge.outward.y * offset,
        };
        const rotation = resolveScreenReadableAnnotationRotation(
          edge.readableAngleDeg,
          canvasRotationDeg,
        ) * Math.PI / 180;
        const dx = local.x - center.x;
        const dy = local.y - center.y;
        const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
        const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
        const width = Math.max(
          EDGE_PILL_MIN_WIDTH,
          label.length * EDGE_PILL_CHAR_WIDTH + EDGE_PILL_PADDING_X * 2,
        ) * inverseScale;
        return Math.abs(localX) <= width / 2 && Math.abs(localY) <= EDGE_PILL_HEIGHT * inverseScale / 2;
      });
      setHoveredEdgeIndex((current) => current === hovered?.edgeIndex ? current : hovered?.edgeIndex);
    };
    const clearHover = () => setHoveredEdgeIndex(undefined);
    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("pointerleave", clearHover, { passive: true });
    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", clearHover);
    };
  }, [canvasRotationDeg, edges, inverseScale, offset]);

  return (
    <Group ref={groupRef} listening={false}>
      {edges.map((edge) => {
        const displayLabel = edgeDisplayLabel(edge);
        const labelPoint = {
          x: edge.midpoint.x + edge.outward.x * offset,
          y: edge.midpoint.y + edge.outward.y * offset,
        };
        const lineStart = {
          x: edge.start.x + edge.outward.x * offset,
          y: edge.start.y + edge.outward.y * offset,
        };
        const lineEnd = {
          x: edge.end.x + edge.outward.x * offset,
          y: edge.end.y + edge.outward.y * offset,
        };
        const tick = 3.5 * inverseScale;
        const pillWidth = Math.max(
          EDGE_PILL_MIN_WIDTH,
          displayLabel.length * EDGE_PILL_CHAR_WIDTH + EDGE_PILL_PADDING_X * 2,
        ) * inverseScale;
        const pillHeight = EDGE_PILL_HEIGHT * inverseScale;
        const labelRotation = resolveScreenReadableAnnotationRotation(
          edge.readableAngleDeg,
          canvasRotationDeg,
        );
        const tooltip = edgeTooltipLabel(edge);
        const tooltipWidth = Math.max(92, tooltip.length * 5.6 + 16) * inverseScale;
        const tooltipHeight = 22 * inverseScale;
        return (
          <Group key={edge.edgeIndex} listening={false}>
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
            <Group x={labelPoint.x} y={labelPoint.y} rotation={labelRotation} listening={false}>
              <Rect
                x={-pillWidth / 2}
                y={-pillHeight / 2}
                width={pillWidth}
                height={pillHeight}
                fill="#FFFFFF"
                cornerRadius={EDGE_PILL_RADIUS * inverseScale}
                shadowColor="#000000"
                shadowBlur={3 * inverseScale}
                shadowOffsetY={1 * inverseScale}
                shadowOpacity={0.24}
                listening={false}
              />
              <Text
                x={-pillWidth / 2 + EDGE_PILL_PADDING_X * inverseScale}
                y={-pillHeight / 2}
                width={pillWidth - EDGE_PILL_PADDING_X * 2 * inverseScale}
                height={pillHeight}
                text={displayLabel}
                fill="#000000"
                fontSize={EDGE_PILL_FONT_SIZE * inverseScale}
                fontStyle="600"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
              {hoveredEdgeIndex === edge.edgeIndex && (
                <Group y={-pillHeight / 2 - tooltipHeight - 5 * inverseScale} listening={false}>
                  <Rect
                    x={-tooltipWidth / 2}
                    width={tooltipWidth}
                    height={tooltipHeight}
                    fill="rgba(10, 18, 28, 0.94)"
                    stroke="rgba(234, 246, 255, 0.32)"
                    strokeWidth={0.75 * inverseScale}
                    cornerRadius={5 * inverseScale}
                    shadowColor="#000000"
                    shadowBlur={4 * inverseScale}
                    shadowOpacity={0.3}
                    listening={false}
                  />
                  <Text
                    x={-tooltipWidth / 2 + 8 * inverseScale}
                    width={tooltipWidth - 16 * inverseScale}
                    height={tooltipHeight}
                    text={tooltip}
                    fill={plannerTheme.textLight}
                    fontSize={9.5 * inverseScale}
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                  />
                </Group>
              )}
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}

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
  const shapeMode = usePlannerV2Store((state) => state.ui.roofShapeMode);
  const scale = usePlannerV2Store((state) => state.view.scale || state.view.fitScale || 1);
  const fitScale = usePlannerV2Store((state) => state.view.fitScale || 1);
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
  const edgeMarginsM = resolveRoofEdgeMarginsM({ ...roof, points: [...points] }, marginM);
  const visibleMarginM = edgeMarginsM?.length ? Math.max(...edgeMarginsM) : marginM;
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
  const showLabels = shouldShowRoofLabels(scale, fitScale);
  const showEdgeInfo = showLabels && shapeMode !== "trapezio";
  const useSharedEdgePills = !selectedZone;
  const offset = (useSharedEdgePills ? 24 : 18) * inverseScale;
  const adapter = { mppImage, metricOriginPx: { x: 0, y: 0 } };
  const usableRoof = visibleMarginM > 0
    ? computeUsableRoof({
        roofPolygonM: imagePolygonToMetric([...points], adapter),
        marginM,
        edgeMarginsM,
      })
    : null;
  const usableComponentsPx = usableRoof?.status === "valid"
    ? usableRoof.components.map((component) => metricPolygonToImage(component, adapter))
    : [];
  return (
    <Group id={`roof-annotation-transform-${roof.id}`} listening={false}>
      {visibleMarginM > 0 && (
        <Group listening={false}>
          <RoofMarginBand
            polygon={[...points]}
            marginPx={visibleMarginM / mppImage}
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

      {showEdgeInfo && useSharedEdgePills && (
        <EdgeHud
          edges={model.edges}
          inverseScale={inverseScale}
          offset={offset}
          canvasRotationDeg={canvasRotationDeg}
        />
      )}
      {showEdgeInfo && !useSharedEdgePills && model.edges.map((edge) => {
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
        const displayLabel = edge.label;
        const labelRotation = edge.readableAngleDeg;
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
          </Group>
        );
      })}
      {!selectedZone && shapeMode !== "trapezio" && (
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
