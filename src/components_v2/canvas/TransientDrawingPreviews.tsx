"use client";

import { useSyncExternalStore } from "react";
import { Group, Line, Text } from "react-konva";

import type { Pt, Tool } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import type { RafPointChannel } from "./performance/rafPointChannel";
import { createRoofRelativeRectangle } from "@/lib/planning-core/geometry-v2";
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
    return (
      <Line
        points={[snowDraft[0].x, snowDraft[0].y, mouseImg.x, mouseImg.y]}
        stroke={plannerTheme.primary}
        strokeWidth={1}
        lineCap="round"
        dash={[4, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
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
