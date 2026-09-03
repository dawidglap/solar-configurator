import { K2_D_DOME_SYSTEM_ID } from "@/lib/planning-core/advanced";
import type { PanelInstance } from "@/types/planner";

/** Keeps the physical D-Dome pair atomic without changing Standard selection. */
export function resolvePanelSelectionIds(
  panels: readonly PanelInstance[],
  clickedId: string,
): string[] {
  const clicked = panels.find((panel) => panel.id === clickedId);
  if (
    clicked?.advanced?.systemId !== K2_D_DOME_SYSTEM_ID ||
    !clicked.advanced.blockKey
  ) {
    return [clickedId];
  }
  return panels
    .filter((panel) => panel.advanced?.blockKey === clicked.advanced?.blockKey)
    .sort((first, second) =>
      (first.advanced?.slotIndex ?? 0) - (second.advanced?.slotIndex ?? 0) ||
      first.id.localeCompare(second.id),
    )
    .map((panel) => panel.id);
}

