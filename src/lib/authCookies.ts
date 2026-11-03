import { resolveSessionCookieDomainForHostname } from "@/lib/domainConfig";
import { getCorsHeaders } from "@/lib/cors";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_COOKIE_PATH = "/";

const EXPIRED_COOKIE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

function hostnameFromHostHeader(value: string | null) {
  const first = value?.split(",")[0]?.trim();
  if (!first) return null;
  try {
    return new URL(`https://${first}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveAuthRequestHostname(req: Request) {
  for (const header of ["x-forwarded-host", "host"] as const) {
    const hostname = hostnameFromHostHeader(req.headers.get(header));
    if (hostname) return hostname;
  }
  try {
    return new URL(req.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveAuthCookieDomain(req: Request) {
  return resolveSessionCookieDomainForHostname(resolveAuthRequestHostname(req));
}

function sharedAttributes(production: boolean) {
  return [
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    ...(production ? ["Secure", "SameSite=None"] : ["SameSite=Lax"]),
  ];
}

function serializeSessionCookie(input: {
  value: string;
  production: boolean;
  domain?: string | null;
  expired?: boolean;
}) {
  return [
    `${SESSION_COOKIE_NAME}=${input.value}`,
    ...sharedAttributes(input.production),
    ...(input.domain ? [`Domain=${input.domain}`] : []),
    ...(input.expired ? ["Max-Age=0", `Expires=${EXPIRED_COOKIE_DATE}`] : []),
  ].join("; ");
}

function expireSessionCookie(production: boolean, domain?: string | null) {
  return serializeSessionCookie({
    value: "",
    production,
    domain,
    expired: true,
  });
}

export function buildLoginSessionCookies(
  req: Request,
  token: string,
  production = process.env.NODE_ENV === "production",
) {
  const domain = production ? resolveAuthCookieDomain(req) : null;
  const currentCookie = serializeSessionCookie({ value: token, production, domain });
  if (!production || !domain) return [currentCookie];

  // A Domain cookie does not overwrite an older host-only cookie with the
  // same name. Expire that variant first so browsers send exactly one token.
  return [expireSessionCookie(production), currentCookie];
}

export function buildLogoutSessionCookies(
  req: Request,
  production = process.env.NODE_ENV === "production",
) {
  const domain = production ? resolveAuthCookieDomain(req) : null;
  const cookies = domain ? [expireSessionCookie(production, domain)] : [];
  cookies.push(expireSessionCookie(production));
  return cookies;
}

export function appendSetCookieHeaders(headers: Headers, cookies: string[]) {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

export function buildLogoutResponse(
  req: Request,
  production = process.env.NODE_ENV === "production",
) {
  const origin = req.headers.get("origin");
  const headers = appendSetCookieHeaders(
    new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(origin),
    }),
    buildLogoutSessionCookies(req, production),
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
