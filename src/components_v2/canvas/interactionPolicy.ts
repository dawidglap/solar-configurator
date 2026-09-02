import type { Pt, Tool } from "@/types/planner";

export type PlannerInteractionMode =
  | "select"
  | "panning"
  | "drawing-roof"
  | "drawing-rectangle"
  | "drawing-reserved-zone"
  | "drawing-reserved-rectangle"
  | "drawing-snow-guard"
  | "fill-area"
  | "editing";

export type PointerIntent = "pan" | "draw" | "edit-or-select";

export type EscapeAction =
  | "cancel-draft"
  | "clear-panels"
  | "clear-zone"
  | "clear-snow-guard"
  | "clear-roof"
  | "none";

type RoofPolygon = { id: string; points: Pt[] };

const DRAWING_TOOLS = new Set<Tool>([
  "draw-roof",
  "draw-rect",
  "draw-reserved",
  "draw-reserved-rect",
  "draw-snow-guard",
  "fill-area",
]);

export function isDrawingInteractionTool(tool: Tool): boolean {
  return DRAWING_TOOLS.has(tool);
}

export function resolvePlannerInteractionMode(input: {
  tool: Tool;
  isRightPanning?: boolean;
  isEditing?: boolean;
}): PlannerInteractionMode {
  if (input.isRightPanning) return "panning";

  switch (input.tool) {
    case "draw-roof":
      return "drawing-roof";
    case "draw-rect":
      return "drawing-rectangle";
    case "draw-reserved":
      return "drawing-reserved-zone";
    case "draw-reserved-rect":
      return "drawing-reserved-rectangle";
    case "draw-snow-guard":
      return "drawing-snow-guard";
    case "fill-area":
      return "fill-area";
    default:
      return input.isEditing ? "editing" : "select";
  }
}

export function resolvePointerIntent(input: {
  button?: number;
  tool: Tool;
  isRightPanning?: boolean;
}): PointerIntent {
  if (input.button === 2 || input.isRightPanning) return "pan";
  return isDrawingInteractionTool(input.tool) ? "draw" : "edit-or-select";
}

export function isPrimaryPointerButton(button: number | undefined): boolean {
  return button === undefined || button === 0;
}

export function resolveInteractionCursor(input: {
  mode: PlannerInteractionMode;
  canPan: boolean;
}): "default" | "grab" | "grabbing" | "crosshair" {
  if (input.mode === "panning") return "grabbing";
  if (input.mode.startsWith("drawing-") || input.mode === "fill-area") {
    return "crosshair";
  }
  if (input.mode === "select" && input.canPan) return "grab";
  return "default";
}

export function shouldIgnorePlannerHotkeyTarget(
  target: EventTarget | null,
): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;

  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (element.isContentEditable) return true;

  return Boolean(
    element.closest?.(
      'input,textarea,select,[contenteditable="true"],[data-stop-hotkeys="true"]',
    ),
  );
}

export function resolveEscapeAction(input: {
  ignoredTarget?: boolean;
  hasDraft: boolean;
  selectedPanelCount: number;
  hasSelectedZone: boolean;
  hasSelectedSnowGuard: boolean;
  hasSelectedRoof: boolean;
}): EscapeAction {
  if (input.ignoredTarget) return "none";
  if (input.hasDraft) return "cancel-draft";
  if (input.selectedPanelCount > 0) return "clear-panels";
  if (input.hasSelectedZone) return "clear-zone";
  if (input.hasSelectedSnowGuard) return "clear-snow-guard";
  if (input.hasSelectedRoof) return "clear-roof";
  return "none";
}

export function shouldCancelDraftOnToolChange(
  previousTool: Tool,
  nextTool: Tool,
): boolean {
  return previousTool !== nextTool && isDrawingInteractionTool(previousTool);
}

export function isPointInsidePolygon(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y || 1e-9) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Last rendered roof wins when roof polygons overlap. */
export function findRoofAtPoint(
  point: Pt,
  roofs: RoofPolygon[],
): RoofPolygon | undefined {
  for (let index = roofs.length - 1; index >= 0; index -= 1) {
    const roof = roofs[index];
    if (roof.points.length >= 3 && isPointInsidePolygon(point, roof.points)) {
      return roof;
    }
  }
  return undefined;
}

export function resolveDraftRoofTarget(input: {
  point: Pt;
  roofs: RoofPolygon[];
  targetRoofId?: string;
}): { accepted: boolean; targetRoofId?: string } {
  if (input.targetRoofId) {
    const roof = input.roofs.find((candidate) => candidate.id === input.targetRoofId);
    return {
      accepted: Boolean(
        roof &&
          roof.points.length >= 3 &&
          isPointInsidePolygon(input.point, roof.points),
      ),
      targetRoofId: input.targetRoofId,
    };
  }

  const roof = findRoofAtPoint(input.point, input.roofs);
  return roof
    ? { accepted: true, targetRoofId: roof.id }
    : { accepted: false, targetRoofId: undefined };
}
