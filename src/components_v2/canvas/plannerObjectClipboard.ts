import type { PanelInstance } from "@/types/planner";

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

export type PlannerObjectClipboard = RoofClipboardPayload | PanelsClipboardPayload;

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

export function markPanelClipboardPaste(): void {
  if (clipboard?.type !== "panels") return;
  clipboard = { ...clipboard, pasteCount: clipboard.pasteCount + 1 };
}

/** Test-only reset; the clipboard is intentionally transient and never persisted. */
export function clearPlannerObjectClipboard(): void {
  clipboard = undefined;
}
