"use client";

import { useSyncExternalStore } from "react";
import { Group, Line, Text } from "react-konva";

import type { Pt, Tool } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import type { RafPointChannel } from "./performance/rafPointChannel";
import {
  createButtEndedStripPolygon,
  createRoofRelativeRectangle,
  SNOW_GUARD_WIDTH_M,
} from "@/lib/planning-core/geometry-v2";
import type { ReservedRectangleDraft } from "./hooks/useDrawingTools";

export default function TransientDrawingPreviews({
  tool,
  snowDraft,
  rectDraft,
  reservedRectDraft,
  pointer,
  mppImage,
}: {
  tool: Tool;
  snowDraft: Pt[] | null;
  rectDraft: Pt[] | null;
  reservedRectDraft: ReservedRectangleDraft | null;
  pointer: RafPointChannel;
  mppImage?: number;
}) {
  const mouseImg = useSyncExternalStore(
    pointer.subscribe,
    pointer.getSnapshot,
    pointer.getServerSnapshot,
  );

  if (!mouseImg) return null;
  if (tool === "draw-reserved-rect" && reservedRectDraft) {
    const candidate = createRoofRelativeRectangle({
      dragStart: reservedRectDraft.start,
      dragEnd: mouseImg,
      ownerRoofPoints: reservedRectDraft.roofPoints,
      roofKind: reservedRectDraft.roofKind,
      referenceEdgeIndex: reservedRectDraft.referenceEdgeIndex,
      minimumSidePx: 1,
    });
    if (candidate.points.length !== 4) return null;
    const center = {
      x: candidate.points.reduce((sum, point) => sum + point.x, 0) / 4,
      y: candidate.points.reduce((sum, point) => sum + point.y, 0) / 4,
    };
    const dimensionLabel = mppImage && candidate.widthPx != null && candidate.heightPx != null
      ? `${(candidate.widthPx * mppImage).toFixed(2)} × ${(candidate.heightPx * mppImage).toFixed(2)} m`
      : "";
    return (
      <Group listening={false}>
        <Line
          points={candidate.points.flatMap((point) => [point.x, point.y])}
          closed
          fill={candidate.valid ? plannerTheme.dangerSoft : "rgba(245, 158, 11, 0.18)"}
          stroke={candidate.valid ? plannerTheme.danger : plannerTheme.warning}
          strokeWidth={1.2}
          dash={candidate.valid ? undefined : [4, 3]}
          listening={false}
          perfectDrawEnabled={false}
        />
        {dimensionLabel && (
          <Text
            x={center.x}
            y={center.y}
            text={dimensionLabel}
            fontSize={8}
            fill={plannerTheme.textLight}
            offsetX={dimensionLabel.length * 2}
            offsetY={-4}
            listening={false}
          />
        )}
      </Group>
    );
  }
  if (tool === "draw-snow-guard" && snowDraft?.length === 1) {
    if (!(mppImage && mppImage > 0)) return null;
    const strip = createButtEndedStripPolygon({
      start: snowDraft[0],
      end: mouseImg,
      width: SNOW_GUARD_WIDTH_M / mppImage,
    });
    if (strip.length !== 4) return null;
    const lengthM = Math.hypot(
      mouseImg.x - snowDraft[0].x,
      mouseImg.y - snowDraft[0].y,
    ) * mppImage;
    const center = {
      x: (snowDraft[0].x + mouseImg.x) / 2,
      y: (snowDraft[0].y + mouseImg.y) / 2,
    };
    const rail = (offset: number) => [
      strip[0].x + (strip[3].x - strip[0].x) * offset,
      strip[0].y + (strip[3].y - strip[0].y) * offset,
      strip[1].x + (strip[2].x - strip[1].x) * offset,
      strip[1].y + (strip[2].y - strip[1].y) * offset,
    ];
    return (
      <Group listening={false}>
        <Line
          points={strip.flatMap((point) => [point.x, point.y])}
          closed
          fillLinearGradientStartPoint={strip[0]}
          fillLinearGradientEndPoint={strip[3]}
          fillLinearGradientColorStops={[
            0, "rgba(71, 85, 105, 0.9)",
            0.2, "rgba(203, 213, 225, 0.94)",
            0.5, "rgba(248, 250, 252, 0.96)",
            0.75, "rgba(148, 163, 184, 0.94)",
            1, "rgba(51, 65, 85, 0.9)",
          ]}
          stroke={plannerTheme.primary}
          strokeWidth={1.2}
          lineJoin="miter"
          dash={[4, 3]}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Line
          points={rail(0.28)}
          stroke="rgba(248, 250, 252, 0.95)"
          strokeWidth={0.55}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Line
          points={rail(0.72)}
          stroke="rgba(51, 65, 85, 0.9)"
          strokeWidth={0.55}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Text
          x={center.x}
          y={center.y}
          text={`${lengthM.toFixed(2)} m`}
          fontSize={8}
          fill={plannerTheme.textLight}
          offsetX={14}
          offsetY={-5}
          listening={false}
        />
      </Group>
    );
  }
  if (tool === "draw-rect" && rectDraft?.length === 1) {
    return (
      <Line
        points={[rectDraft[0].x, rectDraft[0].y, mouseImg.x, mouseImg.y]}
        stroke={plannerTheme.primary}
        strokeWidth={1}
        lineCap="round"
        dash={[4, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }
  return null;
}
