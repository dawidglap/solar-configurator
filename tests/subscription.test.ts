import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanySubscriptionResponse,
  buildNewCompanySubscriptionDefaults,
  computeDaysRemaining,
  hasStoredCompanySubscription,
  normalizeCompanySubscription,
  resolveAutomatedCompanySubscriptionStatus,
} from "../src/lib/subscription";

const permanentCompany = {
  plan: "business",
  subscriptionStatus: "active",
  validUntil: null,
  maxUsers: 25,
  notes: "existing company",
};

test("explicit null validUntil remains permanent throughout normalization", () => {
  const normalized = normalizeCompanySubscription(permanentCompany);
  assert.equal(normalized.validUntil, null);
  assert.equal(hasStoredCompanySubscription(permanentCompany), true);
  assert.equal(computeDaysRemaining(null), null);
  assert.deepEqual(buildCompanySubscriptionResponse(permanentCompany), {
    plan: "business",
    status: "active",
    validUntil: null,
    unlimited: true,
    maxUsers: 25,
    suspended: false,
    notes: "existing company",
    daysRemaining: null,
  });
});

test("a suspended permanent company remains explicitly suspended", () => {
  const response = buildCompanySubscriptionResponse({
    ...permanentCompany,
    subscriptionStatus: "suspended",
  });
  assert.equal(response.unlimited, true);
  assert.equal(response.suspended, true);
});

test("automated status updates implement permanent, timed, expired, and suspended semantics", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  assert.equal(
    resolveAutomatedCompanySubscriptionStatus(
      { subscriptionStatus: "active", validUntil: null },
      now,
    ),
    "active",
  );
  assert.equal(
    resolveAutomatedCompanySubscriptionStatus(
      { subscriptionStatus: "trial", validUntil: new Date("2026-12-05T12:00:00.000Z") },
      now,
    ),
    "trial",
  );
  assert.equal(
    resolveAutomatedCompanySubscriptionStatus(
      { subscriptionStatus: "active", validUntil: new Date("2026-11-04T12:00:00.000Z") },
      now,
    ),
    "suspended",
  );
  assert.equal(
    resolveAutomatedCompanySubscriptionStatus(
      { subscriptionStatus: "suspended", validUntil: new Date("2027-11-05T12:00:00.000Z") },
      now,
    ),
    "suspended",
  );
});

test("new companies still receive the configured timed trial", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const defaults = buildNewCompanySubscriptionDefaults(now);
  assert.equal(defaults.subscriptionStatus, "trial");
  assert.equal(defaults.validUntil.toISOString(), "2026-12-05T12:00:00.000Z");
});

test("missing validUntil still receives the legacy timed fallback", () => {
  const fallbackDate = new Date("2026-12-31T00:00:00.000Z");
  const normalized = normalizeCompanySubscription(
    { ...permanentCompany, validUntil: undefined },
    {
      plan: "starter",
      subscriptionStatus: "trial",
      validUntil: fallbackDate,
      maxUsers: 5,
      notes: "",
    },
  );
  assert.equal(normalized.validUntil, fallbackDate);
});
