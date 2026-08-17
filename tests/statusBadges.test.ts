import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  deriveLinkedSignatureStatus,
  derivePlanningBadgeFields,
} from "../src/lib/statusBadges";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/status-badges-unit-tests";

test("derives all three Vollmacht badge states", () => {
  assert.deepEqual(derivePlanningBadgeFields({
    data: { parts: { formDocuments: { vollmacht: false } } },
  }), {
    vollmachtRequired: false,
    vollmachtStatus: "not_required",
    vollmachtSubmittedAt: null,
    withdrawalUntil: null,
  });

  assert.deepEqual(derivePlanningBadgeFields({}), {
    vollmachtRequired: true,
    vollmachtStatus: "pending",
    vollmachtSubmittedAt: null,
    withdrawalUntil: null,
  });

  assert.deepEqual(derivePlanningBadgeFields({
    vollmachtSubmittedAt: new Date("2026-08-18T10:15:00.000Z"),
  }), {
    vollmachtRequired: true,
    vollmachtStatus: "submitted",
    vollmachtSubmittedAt: "2026-08-18T10:15:00.000Z",
    withdrawalUntil: null,
  });
});

test("returns withdrawalUntil only for an onsite-customer signature", () => {
  const signedAt = "2026-08-18T12:30:00.000Z";
  assert.equal(derivePlanningBadgeFields({
    offerSignaturePlace: "onsite_customer",
    offerSignedAt: signedAt,
  }).withdrawalUntil, "2026-09-01T12:30:00.000Z");

  for (const offerSignaturePlace of ["remote", "onsite_company", ""]) {
    assert.equal(derivePlanningBadgeFields({
      offerSignaturePlace,
      offerSignedAt: signedAt,
      withdrawalUntil: "2026-09-01T12:30:00.000Z",
    }).withdrawalUntil, null);
  }
});

test("prefers the offer-signature status and falls back to the legacy status", () => {
  assert.equal(deriveLinkedSignatureStatus({ offerSignatureStatus: "viewed" }), "viewed");
  assert.equal(deriveLinkedSignatureStatus({
    offerSignatureStatus: "none",
    signatureStatus: "signed",
  }), "signed");
  assert.equal(deriveLinkedSignatureStatus({ offerSignatureStatus: "unknown" }), "none");
});

test("order and execution serializers expose the badge fields without per-item lookups", async () => {
  const [{ normalizeOrderFields }, { normalizeExecutionTask }] = await Promise.all([
    import("../src/lib/orders"),
    import("../src/lib/executionTasks"),
  ]);
  const planningId = new ObjectId();
  const planning = {
    _id: planningId,
    orderId: "AUF-2026-0042",
    data: { parts: { formDocuments: { vollmacht: true } } },
    vollmachtSubmittedAt: new Date("2026-08-18T10:15:00.000Z"),
    offerSignatureStatus: "signed",
    offerSignaturePlace: "onsite_customer",
    offerSignedAt: new Date("2026-08-18T12:30:00.000Z"),
  };

  assert.deepEqual({
    vollmachtRequired: normalizeOrderFields(planning).vollmachtRequired,
    vollmachtStatus: normalizeOrderFields(planning).vollmachtStatus,
    vollmachtSubmittedAt: normalizeOrderFields(planning).vollmachtSubmittedAt,
    withdrawalUntil: normalizeOrderFields(planning).withdrawalUntil,
  }, {
    vollmachtRequired: true,
    vollmachtStatus: "submitted",
    vollmachtSubmittedAt: "2026-08-18T10:15:00.000Z",
    withdrawalUntil: "2026-09-01T12:30:00.000Z",
  });

  const task = normalizeExecutionTask({
    _id: new ObjectId(),
    companyId: new ObjectId(),
    planningId,
    track: "montage",
  }, { planningById: new Map([[planningId.toString(), planning]]) });
  assert.equal(task.orderId, "AUF-2026-0042");
  assert.equal(task.vollmachtRequired, true);
  assert.equal(task.vollmachtStatus, "submitted");
  assert.equal(task.vollmachtSubmittedAt, "2026-08-18T10:15:00.000Z");
  assert.equal(task.withdrawalUntil, "2026-09-01T12:30:00.000Z");
  assert.equal(task.signatureStatus, "signed");
});

test("counts only overdue and unpaid invoices", async () => {
  const { countOverdueInvoices } = await import("../src/lib/invoices");
  const now = new Date("2026-08-18T12:00:00.000Z");
  const fixtures = [
    { invoiceType: "rechnung", dueDate: "2026-08-17", paymentStatus: "offen", status: "versendet" },
    { invoiceType: "rechnung", dueDate: "2026-08-10", paymentStatus: "teilweise", status: "versendet" },
    { invoiceType: "rechnung", dueDate: "2026-08-10", paymentStatus: "bezahlt", status: "versendet" },
    { invoiceType: "rechnung", dueDate: "2026-08-10", paymentStatus: "offen", status: "storniert" },
    { invoiceType: "rechnung", dueDate: "2026-08-18", paymentStatus: "offen", status: "versendet" },
    { invoiceType: "rechnung", dueDate: "2026-08-19", paymentStatus: "offen", status: "versendet" },
    { invoiceType: "mahnung", dueDate: "2026-08-01", paymentStatus: "offen", status: "mahnung" },
  ];

  assert.equal(countOverdueInvoices(fixtures, now), 2);
});
