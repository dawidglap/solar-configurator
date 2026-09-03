export type PlannerSessionMode = "new" | "existing";

/**
 * A persisted planning identity is the safety boundary. Address metadata must
 * never be able to bootstrap another site into that document.
 */
export function resolvePlannerSessionMode(
  input: {
    planningId: string | null | undefined;
    hasEstablishedSite: boolean;
  },
): PlannerSessionMode {
  return input.planningId?.trim() && input.hasEstablishedSite ? "existing" : "new";
}

export function canBootstrapPlanningFromAddress(
  mode: PlannerSessionMode,
): boolean {
  return mode === "new";
}
