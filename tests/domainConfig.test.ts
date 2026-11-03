import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_CRM_ORIGIN,
  CANONICAL_PLANNER_ORIGIN,
  CRM_ORIGINS,
  PLANNER_ORIGINS,
  PUBLIC_DOCUMENT_FRAME_ANCESTORS_CSP,
  resolveSessionCookieDomain,
} from "../src/lib/domainConfig";

test("uses vieon.ch as the canonical CRM and planner domains", () => {
  assert.equal(CANONICAL_CRM_ORIGIN, "https://app.vieon.ch");
  assert.equal(CANONICAL_PLANNER_ORIGIN, "https://planner.vieon.ch");
});

test("keeps both canonical and legacy origins during migration", () => {
  assert.deepEqual(CRM_ORIGINS, ["https://app.vieon.ch", "https://app.helionic.ch"]);
  assert.deepEqual(PLANNER_ORIGINS, [
    "https://planner.vieon.ch",
    "https://planner.helionic.ch",
  ]);
  assert.match(PUBLIC_DOCUMENT_FRAME_ANCESTORS_CSP, /https:\/\/app\.vieon\.ch/);
  assert.match(PUBLIC_DOCUMENT_FRAME_ANCESTORS_CSP, /https:\/\/app\.helionic\.ch/);
});

test("selects the shared cookie domain without crossing registrable domains", () => {
  assert.equal(resolveSessionCookieDomain({ origin: "https://app.vieon.ch" }), ".vieon.ch");
  assert.equal(resolveSessionCookieDomain({ origin: "https://app.helionic.ch" }), ".helionic.ch");
  assert.equal(
    resolveSessionCookieDomain({ requestUrl: "https://planner.vieon.ch/api/auth/login" }),
    ".vieon.ch",
  );
  assert.equal(resolveSessionCookieDomain({ origin: "https://evil.example" }), null);
});
