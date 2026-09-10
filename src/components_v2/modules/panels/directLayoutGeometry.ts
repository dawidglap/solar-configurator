import { K2_D_DOME_SYSTEM_ID } from "@/lib/planning-core/advanced";
import type { PanelInstance } from "@/types/planner";
import { resolvePanelSelectionIds } from "./panelSelection";

export type DirectLayoutDirection = "up" | "down" | "left" | "right";
export type DirectPanelGeometry = Pick<PanelInstance, "id" | "cx" | "cy" | "wPx" | "hPx" | "angleDeg" | "advanced">;

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function resolveDirectLayoutTargets(input: {
  panels: readonly PanelInstance[];
  selectedPanelIds: readonly string[];
  roofId: string;
}): PanelInstance[] {
  const roofPanels = input.panels.filter((panel) => panel.roofId === input.roofId);
  if (!input.selectedPanelIds.length) {
    const lockedBlocks = new Set(roofPanels
      .filter((panel) => panel.locked && panel.advanced?.systemId === K2_D_DOME_SYSTEM_ID)
      .map((panel) => panel.advanced?.blockKey));
    return roofPanels.filter((panel) =>
      !panel.locked && !lockedBlocks.has(panel.advanced?.blockKey),
    );
  }

  const requested = new Set<string>();
  input.selectedPanelIds.forEach((id) => {
    resolvePanelSelectionIds(roofPanels, id).forEach((resolvedId) => requested.add(resolvedId));
  });
  const requestedPanels = roofPanels.filter((panel) => requested.has(panel.id));
  const lockedBlocks = new Set(requestedPanels
    .filter((panel) => panel.locked && panel.advanced?.systemId === K2_D_DOME_SYSTEM_ID)
    .map((panel) => panel.advanced?.blockKey));
  return requestedPanels.filter((panel) =>
    !panel.locked && !lockedBlocks.has(panel.advanced?.blockKey),
  );
}

export function screenNudgeToImageDelta(input: {
  direction: DirectLayoutDirection;
  distanceM: number;
  mppImage: number;
  canvasRotationDeg: number;
}): { dx: number; dy: number } {
  if (!(input.mppImage > 0) || !(input.distanceM >= 0)) return { dx: 0, dy: 0 };
  const distancePx = input.distanceM / input.mppImage;
  const screen = input.direction === "up" ? { x: 0, y: -distancePx }
    : input.direction === "down" ? { x: 0, y: distancePx }
      : input.direction === "left" ? { x: -distancePx, y: 0 }
        : { x: distancePx, y: 0 };
  const radians = input.canvasRotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    dx: screen.x * cos + screen.y * sin,
    dy: -screen.x * sin + screen.y * cos,
  };
}

function panelCorners(panel: DirectPanelGeometry): Array<{ x: number; y: number }> {
  const radians = panel.angleDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = panel.wPx / 2;
  const halfHeight = panel.hPx / 2;
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: panel.cx + point.x * cos - point.y * sin,
    y: panel.cy + point.x * sin + point.y * cos,
  }));
}

export function resolveDirectLayoutPivot(
  panels: readonly DirectPanelGeometry[],
): { x: number; y: number } | undefined {
  if (!panels.length) return undefined;
  if (panels.length === 1) return { x: panels[0].cx, y: panels[0].cy };
  const corners = panels.flatMap(panelCorners);
  return {
    x: (Math.min(...corners.map((point) => point.x)) + Math.max(...corners.map((point) => point.x))) / 2,
    y: (Math.min(...corners.map((point) => point.y)) + Math.max(...corners.map((point) => point.y))) / 2,
  };
}

export function translateDirectPanels(
  panels: readonly PanelInstance[],
  delta: { dx: number; dy: number },
): PanelInstance[] {
  return panels.map((panel) => ({
    ...panel,
    cx: panel.cx + delta.dx,
    cy: panel.cy + delta.dy,
  }));
}

export function rotateDirectPanels(
  panels: readonly PanelInstance[],
  pivot: { x: number; y: number },
  deltaDeg: number,
): PanelInstance[] {
  const radians = deltaDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return panels.map((panel) => {
    const dx = panel.cx - pivot.x;
    const dy = panel.cy - pivot.y;
    return {
      ...panel,
      cx: pivot.x + dx * cos - dy * sin,
      cy: pivot.y + dx * sin + dy * cos,
      angleDeg: normalizeDegrees(panel.angleDeg + deltaDeg),
      ...(panel.advanced ? {
        advanced: {
          ...panel.advanced,
          moduleFaceAzimuthDeg: normalizeDegrees(panel.advanced.moduleFaceAzimuthDeg - deltaDeg),
        },
      } : {}),
    };
  });
}
