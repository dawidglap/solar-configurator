import type { PlannerStep, Tool } from "@/types/planner";

const TOOL_BY_KEY: Readonly<Record<string, Tool>> = {
  a: "select",
  d: "draw-roof",
  r: "draw-rect",
  // TEMPORARILY DISABLED: free-form obstacle drawing is too expensive on
  // lower-end devices. Keep the tool implementation for future reactivation.
  // h: "draw-reserved",
  f: "fill-area",
};

export function resolvePlannerToolHotkey(key: string): Tool | undefined {
  return TOOL_BY_KEY[key.toLowerCase()];
}

export function resolveRoofShapeModeHotkey(input: {
  key: string;
  step: PlannerStep;
  hasSelectedRoof: boolean;
}): "normal" | "trapezio" | undefined {
  if (input.step !== "building" || !input.hasSelectedRoof) return undefined;
  const key = input.key.toLowerCase();
  if (key === "n") return "normal";
  if (key === "t") return "trapezio";
  return undefined;
}

export function resolvePlannerStepForTool(tool: Tool, currentStep: PlannerStep): PlannerStep {
  if (tool === "fill-area") return "modules";
  if (tool === "draw-roof" || tool === "draw-rect" || tool === "draw-reserved" || tool === "draw-reserved-rect" || tool === "draw-snow-guard") {
    return "building";
  }
  return currentStep;
}
