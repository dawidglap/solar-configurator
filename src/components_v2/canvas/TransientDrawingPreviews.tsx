"use client";

import { useSyncExternalStore } from "react";
import { Line } from "react-konva";

import type { Pt, Tool } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import type { RafPointChannel } from "./performance/rafPointChannel";

export default function TransientDrawingPreviews({
  tool,
  snowDraft,
  rectDraft,
  pointer,
}: {
  tool: Tool;
  snowDraft: Pt[] | null;
  rectDraft: Pt[] | null;
  pointer: RafPointChannel;
}) {
  const mouseImg = useSyncExternalStore(
    pointer.subscribe,
    pointer.getSnapshot,
    pointer.getServerSnapshot,
  );

  if (!mouseImg) return null;
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
