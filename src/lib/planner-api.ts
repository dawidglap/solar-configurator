export const PLANNER_API_BASE =
  process.env.NEXT_PUBLIC_PLANNER_API_BASE || "https://planner.helionic.ch/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function normalizeApiUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${PLANNER_API_BASE}${cleanPath}`;
}

export async function plannerApiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(normalizeApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      data?.error || data?.message || "Unbekannter API-Fehler",
      res.status,
    );
  }

  return data as T;
}

export function isAdminLikeRole(input: {
  session?: {
    activeRole?: string | null;
    role?: string | null;
    activeCompanyRole?: string | null;
    membershipRole?: string | null;
    isPlatformSuperAdmin?: boolean;
  } | null;
  user?: {
    isPlatformSuperAdmin?: boolean;
  } | null;
}) {
  if (input.user?.isPlatformSuperAdmin || input.session?.isPlatformSuperAdmin) {
    return true;
  }

  const roleCandidates = [
    input.session?.activeRole,
    input.session?.role,
    input.session?.activeCompanyRole,
    input.session?.membershipRole,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return roleCandidates.some((role) =>
    [
      "inhaber",
      "owner",
      "admin",
      "administrator",
      "company_admin",
      "companyadmin",
    ].includes(role),
  );
}
