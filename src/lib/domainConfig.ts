export const CANONICAL_CRM_ORIGIN = "https://app.vieon.ch";
export const CANONICAL_PLANNER_ORIGIN = "https://planner.vieon.ch";

export const LEGACY_CRM_ORIGIN = "https://app.helionic.ch";
export const LEGACY_PLANNER_ORIGIN = "https://planner.helionic.ch";

export const CRM_ORIGINS = [CANONICAL_CRM_ORIGIN, LEGACY_CRM_ORIGIN] as const;
export const PLANNER_ORIGINS = [
  CANONICAL_PLANNER_ORIGIN,
  LEGACY_PLANNER_ORIGIN,
] as const;

export const PUBLIC_DOCUMENT_FRAME_ANCESTORS_CSP = `frame-ancestors ${[
  ...CRM_ORIGINS,
  "https://*.lovableproject.com",
].join(" ")}`;

const SHARED_COOKIE_DOMAINS = new Map<string, string>([
  ["app.vieon.ch", ".vieon.ch"],
  ["planner.vieon.ch", ".vieon.ch"],
  ["app.helionic.ch", ".helionic.ch"],
  ["planner.helionic.ch", ".helionic.ch"],
]);

function hostnameFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveSessionCookieDomain(input: {
  origin?: string | null;
  requestUrl?: string | null;
}) {
  for (const value of [input.origin, input.requestUrl]) {
    const hostname = hostnameFromUrl(value);
    const domain = hostname ? SHARED_COOKIE_DOMAINS.get(hostname) : null;
    if (domain) return domain;
  }
  return null;
}
