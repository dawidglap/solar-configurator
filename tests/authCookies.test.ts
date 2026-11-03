import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  appendSetCookieHeaders,
  buildLoginSessionCookies,
  buildLogoutResponse,
  buildLogoutSessionCookies,
  resolveAuthCookieDomain,
} from "../src/lib/authCookies";
import { readSession } from "../src/lib/api-session";
import { middleware } from "../src/middleware";

function request(hostname: string, origin: string) {
  return new Request(`https://${hostname}/api/auth/login`, {
    headers: {
      host: hostname,
      "x-forwarded-host": hostname,
      origin,
    },
  });
}

function attributes(cookie: string) {
  return new Map(
    cookie.split(";").slice(1).map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key.toLowerCase(), rest.join("=") || true] as const;
    }),
  );
}

function signedSession(secret: string, userId: string, iat: number) {
  const payload = Buffer.from(JSON.stringify({ userId, iat })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

test("vieon login expires a host-only collision and sets one shared-domain session", () => {
  const req = request("planner.vieon.ch", "https://app.vieon.ch");
  const cookies = buildLoginSessionCookies(req, "fresh-token", true);
  assert.equal(resolveAuthCookieDomain(req), ".vieon.ch");
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^session=;/);
  assert.doesNotMatch(cookies[0], /Domain=/i);
  assert.match(cookies[0], /Max-Age=0/i);
  assert.match(cookies[1], /^session=fresh-token;/);
  assert.match(cookies[1], /Domain=\.vieon\.ch/i);
});

test("request host deterministically selects the stack even when Origin disagrees", () => {
  assert.equal(
    resolveAuthCookieDomain(request("planner.vieon.ch", "https://app.helionic.ch")),
    ".vieon.ch",
  );
  assert.equal(
    resolveAuthCookieDomain(request("planner.helionic.ch", "https://app.vieon.ch")),
    ".helionic.ch",
  );
});

test("vieon logout deletes the exact domain scope plus the host-only migration variant", () => {
  const req = request("planner.vieon.ch", "https://app.vieon.ch");
  const setCookie = buildLoginSessionCookies(req, "fresh-token", true)[1];
  const deleted = buildLogoutSessionCookies(req, true);
  assert.equal(deleted.length, 2);

  const setAttributes = attributes(setCookie);
  const domainDeleteAttributes = attributes(deleted[0]);
  for (const key of ["path", "httponly", "secure", "samesite", "domain"]) {
    assert.equal(domainDeleteAttributes.get(key), setAttributes.get(key), key);
  }
  assert.equal(domainDeleteAttributes.get("max-age"), "0");
  assert.equal(attributes(deleted[1]).has("domain"), false);
});

test("legacy helionic login and logout retain their shared cookie scope", () => {
  const req = request("planner.helionic.ch", "https://app.helionic.ch");
  assert.match(buildLoginSessionCookies(req, "legacy-token", true)[1], /Domain=\.helionic\.ch/i);
  assert.match(buildLogoutSessionCookies(req, true)[0], /Domain=\.helionic\.ch/i);
});

test("preview login stays host-only and does not invent a registrable domain", () => {
  const req = request("solar-configurator-preview.vercel.app", "https://preview.example");
  const cookies = buildLoginSessionCookies(req, "preview-token", true);
  assert.equal(cookies.length, 1);
  assert.doesNotMatch(cookies[0], /Domain=/i);
});

test("session refresh selects the newest valid token from duplicate cookie variants", () => {
  const secret = "auth-cookie-regression-secret";
  const stale = signedSession(secret, "stale-user", 100);
  const fresh = signedSession(secret, "fresh-user", 200);
  for (const cookie of [`session=${stale}; session=${fresh}`, `session=${fresh}; session=${stale}`]) {
    const session = readSession(new Request("https://planner.vieon.ch/api/me", {
      headers: { cookie },
    }), secret);
    assert.equal(session?.userId, "fresh-user");
  }
});

test("production logout response supports credentialed vieon CORS and emits both deletions", async () => {
  const response = buildLogoutResponse(new Request("https://planner.vieon.ch/api/auth/logout", {
    method: "POST",
    headers: {
      host: "planner.vieon.ch",
      "x-forwarded-host": "planner.vieon.ch",
      origin: "https://app.vieon.ch",
    },
  }), true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.vieon.ch");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(response.headers.getSetCookie().length, 2);
});

test("logout then second login produces a fresh scoped cookie deterministically", () => {
  const req = request("planner.vieon.ch", "https://app.vieon.ch");
  const firstLogin = buildLoginSessionCookies(req, "token-1", true);
  const loggedOut = buildLogoutSessionCookies(req, true);
  const secondLogin = buildLoginSessionCookies(req, "token-2", true);
  assert.match(firstLogin[1], /^session=token-1;/);
  assert.ok(loggedOut.every((cookie) => /Max-Age=0/i.test(cookie)));
  assert.match(secondLogin[1], /^session=token-2;/);
  assert.equal(attributes(firstLogin[1]).get("domain"), attributes(secondLogin[1]).get("domain"));
});

test("multiple Set-Cookie headers are preserved instead of comma-folded", () => {
  const req = request("planner.vieon.ch", "https://app.vieon.ch");
  const headers = appendSetCookieHeaders(new Headers(), buildLoginSessionCookies(req, "token", true));
  assert.equal(headers.getSetCookie().length, 2);
});

test("a stale cookie cannot redirect the browser away from login", () => {
  const response = middleware(new NextRequest("https://planner.vieon.ch/login", {
    headers: { cookie: "session=stale-token" },
  }));
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

