import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ObjectId } from "mongodb";
import { readCanonicalHeatingOrder } from "../src/lib/heatingOrderRead";

const companyA = new ObjectId("64f000000000000000000301");
const companyB = new ObjectId("64f000000000000000000302");
const planningA = new ObjectId("64f000000000000000000311");
const planningB = new ObjectId("64f000000000000000000312");
const auftragA = new ObjectId("64f000000000000000000321");
const auftragB = new ObjectId("64f000000000000000000322");
const issuedFile = new ObjectId("64f000000000000000000331");
const signedFile = new ObjectId("64f000000000000000000332");
const orderFile = new ObjectId("64f000000000000000000333");

const snapshot = {
  schemaVersion: 1,
  projectType: "heating",
  planningId: planningA.toString(),
  issuedOffer: {
    offerNumber: "ANG-H-2026-0042",
    issuedAt: "2026-10-21T10:00:00.000Z",
    snapshotFileId: issuedFile.toString(),
    snapshotPdfSha256: "issued-hash",
    signedFileId: signedFile.toString(),
    signedPdfSha256: "signed-hash",
    signedAt: "2026-10-22T10:00:00.000Z",
  },
  customer: {
    name: "Signed Kunde",
    email: "signed@example.ch",
    phone: null,
    salutation: "herr",
    lastName: "Kunde",
    type: "private",
    companyName: null,
    address: { street: "Signedweg", houseNumber: "3", zip: "3000", city: "Bern" },
  },
  objectAddress: {
    formatted: "Heizweg 7, 3010 Bern",
    street: "Heizweg",
    houseNumber: "7",
    zip: "3010",
    city: "Bern",
  },
  items: [{ position: 1, name: "Wärmepumpe", quantity: 1, lineTotalNet: 29_450 }],
  optionalItems: [],
  pricing: {
    subtotalNet: 29_450,
    discount: { fixedChf: 0, percent: 0, percentAmountChf: 0, totalChf: 0 },
    netAfterDiscount: 29_450,
    vatRate: 8.1,
    vatAmount: 2_385.45,
    totalGross: 31_835.45,
  },
  paymentTerms: "50 % / 50 %",
  payments: [{ label: "Anzahlung", pct: 50, amount: 15_917.75, dueDate: null }],
  skonto: { percent: 0, days: 10 },
  validity: { validUntil: "2026-11-20T10:00:00.000Z" },
} as const;

function heatingPlanning(overrides: Record<string, unknown> = {}) {
  return {
    _id: planningA,
    companyId: companyA.toString(),
    customerId: "same-customer",
    projectType: "heating",
    orderStatus: "generated",
    orderId: "AB-2026-0042",
    data: { profile: { firstName: "LIVE CHANGED" }, parts: { items: [] } },
    ...overrides,
  };
}

function heatingAuftrag(overrides: Record<string, unknown> = {}) {
  return {
    _id: auftragA,
    companyId: companyA,
    planningId: planningA,
    customerId: new ObjectId("64f000000000000000000341"),
    orderId: "AB-2026-0042",
    projectType: "heating",
    status: "aktiv",
    currentStepKey: "gewonnen",
    completedAt: null,
    contractTotalGrossChf: 31_835.45,
    currency: "CHF",
    heatingOrderSnapshot: snapshot,
    issuedOfferSnapshotFileId: issuedFile,
    signedOfferFileId: signedFile,
    orderSnapshotFileId: orderFile,
    createdAt: new Date("2026-10-23T10:00:00.000Z"),
    updatedAt: new Date("2026-10-23T10:00:00.000Z"),
    ...overrides,
  };
}

function fakeDb(plannings: any[], auftraege: any[]) {
  const calls: Array<{ collection: string; query: any }> = [];
  const db = {
    collection(name: string) {
      return {
        async findOne(query: any) {
          calls.push({ collection: name, query });
          const docs = name === "plannings" ? plannings : auftraege;
          return docs.find((doc) => {
            if (name === "plannings") {
              return doc._id instanceof ObjectId &&
                doc._id.equals(query._id) &&
                doc.companyId === query.companyId &&
                doc.deletedAt == null;
            }
            return doc.planningId instanceof ObjectId &&
              doc.planningId.equals(query.planningId) &&
              doc.companyId instanceof ObjectId &&
              doc.companyId.equals(query.companyId) &&
              doc.projectType === query.projectType;
          }) ?? null;
        },
      };
    },
  };
  return { db: db as any, calls };
}

test("A. existing Heating Auftrag returns the exact persisted immutable snapshot", async () => {
  const order = heatingAuftrag();
  const { db } = fakeDb([heatingPlanning()], [order]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });

  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.response.exists, true);
  assert.deepEqual(result.response.order?.heatingOrderSnapshot, snapshot);
  assert.equal(result.response.order?.contractTotalGrossChf, 31_835.45);
  assert.equal(result.response.order?.createdAt, "2026-10-23T10:00:00.000Z");
});

test("B. Heating project without Auftrag returns exists=false", async () => {
  const { db } = fakeDb([heatingPlanning({ orderStatus: "none", orderId: null })], []);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.deepEqual(result, {
    kind: "ok",
    response: { ok: true, planningId: planningA.toString(), exists: false, order: null },
  });
});

test("C. signed Heating project after failed order generation still returns exists=false", async () => {
  const { db } = fakeDb([
    heatingPlanning({ offerSignatureStatus: "signed", orderStatus: "none", orderId: null }),
  ], []);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.response.exists, false);
    assert.equal(result.response.order, null);
  }
});

test("D. live customer, address, parts and catalog drift cannot affect the returned snapshot", async () => {
  const liveDrift = heatingPlanning({
    summary: { customerName: "Live Kunde" },
    data: {
      profile: { firstName: "Live Kunde", buildingStreet: "Liveweg" },
      parts: { items: [{ name: "Live Produkt", lineTotalNet: 99_999 }] },
    },
    commercial: { valueChf: 99_999 },
  });
  const { db } = fakeDb([liveDrift], [heatingAuftrag()]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.response.order?.heatingOrderSnapshot.customer.name, "Signed Kunde");
    assert.equal(result.response.order?.heatingOrderSnapshot.objectAddress.street, "Heizweg");
    assert.equal(result.response.order?.heatingOrderSnapshot.pricing.totalGross, 31_835.45);
  }
});

test("E. same customer with two projects returns only the planning-scoped Auftrag", async () => {
  const snapshotB = { ...snapshot, planningId: planningB.toString() };
  const planningDocB = heatingPlanning({ _id: planningB, orderId: "AB-2026-0043" });
  const orderB = heatingAuftrag({
    _id: auftragB,
    planningId: planningB,
    orderId: "AB-2026-0043",
    heatingOrderSnapshot: snapshotB,
  });
  const { db } = fakeDb([heatingPlanning(), planningDocB], [heatingAuftrag(), orderB]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningB.toString(),
  });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.response.order?.auftragId, auftragB.toString());
    assert.equal(result.response.order?.orderId, "AB-2026-0043");
  }
});

test("F. wrong tenant returns not_found and never queries auftraege", async () => {
  const { db, calls } = fakeDb([heatingPlanning()], [heatingAuftrag()]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyB.toString(),
    planningId: planningA.toString(),
  });
  assert.deepEqual(result, { kind: "not_found" });
  assert.deepEqual(calls.map((call) => call.collection), ["plannings"]);
});

test("G. PV project is rejected before any Auftrag lookup", async () => {
  const { db, calls } = fakeDb([heatingPlanning({ projectType: "photovoltaic" })], [heatingAuftrag()]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.deepEqual(result, { kind: "not_heating" });
  assert.deepEqual(calls.map((call) => call.collection), ["plannings"]);
});

test("H. legacy project without projectType remains PV", async () => {
  const planning = heatingPlanning();
  delete (planning as any).projectType;
  const { db, calls } = fakeDb([planning], [heatingAuftrag()]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.deepEqual(result, { kind: "not_heating" });
  assert.deepEqual(calls.map((call) => call.collection), ["plannings"]);
});

test("I. file references are serialized from the canonical Auftrag as strings", async () => {
  const { db } = fakeDb([heatingPlanning()], [heatingAuftrag()]);
  const result = await readCanonicalHeatingOrder({
    db,
    companyId: companyA.toString(),
    planningId: planningA.toString(),
  });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.response.order?.issuedOfferSnapshotFileId, issuedFile.toString());
    assert.equal(result.response.order?.signedOfferFileId, signedFile.toString());
    assert.equal(result.response.order?.orderSnapshotFileId, orderFile.toString());
  }
});

test("route is authenticated, tenant-derived and read-only", () => {
  const source = readFileSync(
    new URL("../src/app/api/plannings/[planningId]/heating-order/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /readSession\(req, secret\)/);
  assert.match(source, /companyId:\s*String\(session\.activeCompanyId\)/);
  assert.doesNotMatch(source, /updateOne|insertOne|deleteOne|findOneAndUpdate|buildPlanningDocumentPdf/);
});
