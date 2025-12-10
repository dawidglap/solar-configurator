// src/components_v2/state/capabilities.ts
import type { PlannerStep, Tool } from "@/types/planner";

/** Matrice delle capacità: quali tool sono permessi in ogni step
 *  (solo per gli step che usano davvero i tools)
 */
export const ALLOWED_TOOLS: Partial<Record<PlannerStep, Readonly<Tool[]>>> = {
  building: ["select", "draw-roof", "draw-rect", "draw-reserved", "draw-snow-guard"],
  modules: ["select", "fill-area"],
  strings: ["select"],
  parts: ["select"],
} as const;

/** Tool di default per ogni step che usa tools */
export const DEFAULT_TOOL: Partial<Record<PlannerStep, Tool>> = {
  building: "select",
  modules: "select", // in futuro potrai mettere 'fill-area'
  strings: "select",
  parts: "select",
} as const;

/** Ritorna true se il tool è ammesso nello step corrente */
export function isToolAllowed(step: PlannerStep, tool: Tool): boolean {
  const allowed = ALLOWED_TOOLS[step];
  if (!allowed) return false; // step come 'profile', 'ist', 'report', 'offer'
  return allowed.includes(tool);
}

/** Tool di default per lo step dato */
export function defaultToolFor(step: PlannerStep): Tool {
  // fallback sicuro: 'select'
  return DEFAULT_TOOL[step] ?? "select";
}
