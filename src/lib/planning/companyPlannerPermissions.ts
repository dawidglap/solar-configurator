import { safeString, type SessionPayload } from "@/lib/api-session";

export function getAuthenticatedCompanyId(
  session: SessionPayload | null | undefined,
): string | null {
  return safeString(session?.activeCompanyId) || null;
}

export function canEditCompanyPlannerDefaults(
  session: SessionPayload | null | undefined,
): boolean {
  if (session?.isPlatformSuperAdmin === true) return true;
  const roles = [
    session?.activeRole,
    session?.role,
    session?.activeCompanyRole,
    session?.membershipRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);

  return roles.some((role) =>
    [
      "owner",
      "inhaber",
      "admin",
      "administrator",
      "company_admin",
      "companyadmin",
    ].includes(role),
  );
}
