const EXPERIMENTAL_3D_USER_EMAIL = "owner@demo-energie.ch";

export type PlannerViewMode = "2d" | "3d";

type AuthenticatedUserIdentity = Readonly<{
  email?: unknown;
}>;

/** Temporary code-level gate based only on the authenticated user identity. */
export function canUseExperimental3D(
  user: AuthenticatedUserIdentity | null | undefined,
): boolean {
  return typeof user?.email === "string" &&
    user.email.trim().toLowerCase() === EXPERIMENTAL_3D_USER_EMAIL;
}

/** Prevents stale or externally supplied 3D state from becoming effective. */
export function resolveEffectivePlannerViewMode(
  requestedViewMode: PlannerViewMode,
  canUse3D: boolean,
): PlannerViewMode {
  return canUse3D && requestedViewMode === "3d" ? "3d" : "2d";
}
