import type { PlannerStep } from "@/types/planner";
import { normalizePlannerStep } from "../normalizePlannerStep";

export type PlanningRouteLoadState = {
  routeKey: string;
  status: "loading" | "ready" | "error";
  error?: string;
};

export function planningRouteKey(planningId: string | null): string {
  return planningId ? `planning:${planningId}` : "planning:new";
}

export function createPlanningRouteLoadState(
  planningId: string | null,
): PlanningRouteLoadState {
  return { routeKey: planningRouteKey(planningId), status: "loading" };
}

export function resolvePlanningRouteStatus(input: {
  planningId: string | null;
  loadState: PlanningRouteLoadState;
}): PlanningRouteLoadState["status"] {
  return input.loadState.routeKey === planningRouteKey(input.planningId)
    ? input.loadState.status
    : "loading";
}

export function isPlannerReady(input: {
  routeStatus: PlanningRouteLoadState["status"];
  storeHydrated: boolean;
}): boolean {
  return input.routeStatus === "ready" && input.storeHydrated;
}

export function resolvePlannerUrlStep(input: {
  plannerStep?: string | null;
  initialStep?: string | null;
  step?: string | null;
  currentStep?: string | null;
}): PlannerStep | undefined {
  return (
    normalizePlannerStep(input.plannerStep) ||
    normalizePlannerStep(input.initialStep) ||
    normalizePlannerStep(input.step) ||
    normalizePlannerStep(input.currentStep) ||
    undefined
  );
}
