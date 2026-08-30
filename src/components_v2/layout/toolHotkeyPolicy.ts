import type { PlannerStep, Tool } from "@/types/planner";

const TOOL_BY_KEY: Readonly<Record<string, Tool>> = {
  a: "select",
  d: "draw-roof",
  r: "draw-rect",
  h: "draw-reserved",
  f: "fill-area",
};

export function resolvePlannerToolHotkey(key: string): Tool | undefined {
  return TOOL_BY_KEY[key.toLowerCase()];
}

export function resolvePlannerStepForTool(tool: Tool, currentStep: PlannerStep): PlannerStep {
  if (tool === "fill-area") return "modules";
  if (tool === "draw-roof" || tool === "draw-rect" || tool === "draw-reserved" || tool === "draw-snow-guard") {
    return "building";
  }
  return currentStep;
}
