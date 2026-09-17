import type { PanelInstance } from "@/types/planner";
import type { Zone } from "../state/slices/zonesSlice";

export type RoofClipboardPayload = {
  type: "roof";
  sourceRoofId: string;
};

export type PanelsClipboardPayload = {
  type: "panels";
  sourceRoofId: string;
  panels: PanelInstance[];
  pasteCount: number;
};

export type ObstacleClipboardPayload = {
  type: "obstacle";
  sourceRoofId: string;
  obstacle: Zone;
  pasteCount: number;
};

export type PlannerObjectClipboard =
  | RoofClipboardPayload
  | PanelsClipboardPayload
  | ObstacleClipboardPayload;

export type PlannerClipboardTarget = "obstacle" | "panels" | "roof" | "none";

/**
 * Resolves copy ownership from the active editable selection. A selected roof
 * is frequently only the parent context, so it is deliberately the last
 * eligible target in Gebäudeplanung and is never a fallback in Modulplanung.
 */
export function resolvePlannerClipboardTarget(input: {
  step?: string;
  tool?: string;
  selectedRoofId?: string;
  selectedZoneId?: string;
  selectedSnowGuardId?: string;
  selectedPanelCount: number;
}): PlannerClipboardTarget {
  if (input.step === "modules") {
    return input.selectedPanelCount > 0 ? "panels" : "none";
  }
  if (input.step !== "building" || input.tool !== "select") return "none";
  if (input.selectedZoneId) return "obstacle";
  // Panel selections belong exclusively to Modulplanung. They can remain in
  // store while switching steps, but must not shadow an otherwise exclusive
  // roof selection in Gebäudeplanung.
  if (input.selectedSnowGuardId) return "none";
  return input.selectedRoofId ? "roof" : "none";
}

let clipboard: PlannerObjectClipboard | undefined;

export function readPlannerObjectClipboard(): PlannerObjectClipboard | undefined {
  return clipboard;
}

export function copyRoofToPlannerClipboard(sourceRoofId: string): void {
  clipboard = { type: "roof", sourceRoofId };
}

export function copyPanelsToPlannerClipboard(input: {
  sourceRoofId: string;
  panels: readonly PanelInstance[];
}): void {
  clipboard = {
    type: "panels",
    sourceRoofId: input.sourceRoofId,
    panels: input.panels.map((panel) => ({
      ...panel,
      ...(panel.advanced ? { advanced: { ...panel.advanced } } : {}),
      ...(panel.standard ? { standard: { ...panel.standard } } : {}),
    })),
    pasteCount: 0,
  };
}

export function copyObstacleToPlannerClipboard(obstacle: Zone): void {
  clipboard = {
    type: "obstacle",
    sourceRoofId: obstacle.roofId,
    obstacle: {
      ...obstacle,
      points: obstacle.points.map((point) => ({ ...point })),
      ...(obstacle.edgeReference
        ? { edgeReference: { ...obstacle.edgeReference } }
        : {}),
    },
    pasteCount: 0,
  };
}

export function markPanelClipboardPaste(): void {
  if (clipboard?.type !== "panels") return;
  clipboard = { ...clipboard, pasteCount: clipboard.pasteCount + 1 };
}

export function markObstacleClipboardPaste(): void {
  if (clipboard?.type !== "obstacle") return;
  clipboard = { ...clipboard, pasteCount: clipboard.pasteCount + 1 };
}

/** Test-only reset; the clipboard is intentionally transient and never persisted. */
export function clearPlannerObjectClipboard(): void {
  clipboard = undefined;
}
