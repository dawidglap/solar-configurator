import { legacyPointInPolygon, legacyRectIntersectsPolygon } from "@/lib/planning-core/legacy-standard/collision";
import type { PanelInstance, Pt } from "@/types/planner";

function panelPolygon(panel: Pick<PanelInstance, "cx" | "cy" | "wPx" | "hPx" | "angleDeg">): Pt[] {
  const radians = (panel.angleDeg * Math.PI) / 180;
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

function pointOnSegment(point: Pt, start: Pt, end: Pt): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-5) return false;
  return point.x >= Math.min(start.x, end.x) - 1e-5 &&
    point.x <= Math.max(start.x, end.x) + 1e-5 &&
    point.y >= Math.min(start.y, end.y) - 1e-5 &&
    point.y <= Math.max(start.y, end.y) + 1e-5;
}

function pointInsideOrOnPolygon(point: Pt, polygon: readonly Pt[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return legacyPointInPolygon(point, [...polygon]);
}

function unitKey(panel: PanelInstance): string {
  return panel.advanced?.blockKey ?? panel.id;
}

/**
 * Selects whole additive placement units inside an operator-drawn area.
 * Existing panels are immutable occupancy; an Advanced block is accepted or
 * rejected as a whole, so an East-West pair can never be split.
 */
export function selectAdditiveFillPanels(input: {
  roofId: string;
  areaPolygon: readonly Pt[];
  candidates: readonly PanelInstance[];
  existingPanels: readonly PanelInstance[];
}): PanelInstance[] {
  if (input.areaPolygon.length < 3) return [];

  const occupancy = input.existingPanels
    .filter((panel) => panel.roofId === input.roofId)
    .map(panelPolygon);
  const units = new Map<string, PanelInstance[]>();
  input.candidates
    .filter((panel) => panel.roofId === input.roofId)
    .forEach((panel) => {
      const key = unitKey(panel);
      units.set(key, [...(units.get(key) ?? []), panel]);
    });

  const accepted: PanelInstance[] = [];
  [...units.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .forEach(([, unit]) => {
      const insideArea = unit.every((panel) =>
        panelPolygon(panel).every((point) => pointInsideOrOnPolygon(point, input.areaPolygon)),
      );
      if (!insideArea) return;

      const collides = unit.some((panel) => {
        const rect = {
          cx: panel.cx,
          cy: panel.cy,
          wPx: panel.wPx,
          hPx: panel.hPx,
          angleDeg: panel.angleDeg,
        };
        return occupancy.some((polygon) => legacyRectIntersectsPolygon(rect, polygon));
      });
      if (collides) return;

      accepted.push(...unit);
      occupancy.push(...unit.map(panelPolygon));
    });

  return accepted;
}

