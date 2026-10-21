import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ObjectId } from "mongodb";
import type { HeatingOfferIssuedSnapshot } from "../src/lib/offerSignatures";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/heating-orders-unit-tests";
const loadHeatingOrders = () => import("../src/lib/heatingOrders");

const planningId = new ObjectId("64f000000000000000000201");
const companyId = new ObjectId("64f000000000000000000202");
const customerId = new ObjectId("64f000000000000000000203");
const snapshotFileId = new ObjectId("64f000000000000000000204");
const signedFileId = new ObjectId("64f000000000000000000205");
const orderFileId = new ObjectId("64f000000000000000000206");

const snapshot: HeatingOfferIssuedSnapshot = {
  schemaVersion: 1,
  projectType: "heating",
  planningId: planningId.toString(),
  offerNumber: "ANG-H-2026-0042",
  documentTitle: "Heizungsangebot",
  issuedAt: "2026-10-21T10:00:00.000Z",
  customer: {
    name: "Issued Kunde",
    email: "issued@example.ch",
    phone: "+41 79 111 22 33",
    salutation: "herr",
    lastName: "Kunde",
    type: "private",
    companyName: null,
    address: { street: "Rechnungsweg", houseNumber: "3", zip: "3000", city: "Bern" },
  },
  objectAddress: {
    formatted: "Heizweg 7, 3010 Bern",
    street: "Heizweg",
    houseNumber: "7",
    zip: "3010",
    city: "Bern",
  },
  items: [
    { position: 1, name: "Wärmepumpe", quantity: 1, unitLabel: "Stk.", unitPriceNet: 25_000, lineTotalNet: 25_000, optional: false },
    { position: 2, name: "Rohrleitung", quantity: 18, unitLabel: "m", unitPriceNet: 100, lineTotalNet: 1_800, optional: false },
    { position: 3, name: "Montage", quantity: 1, unitLabel: "Stk.", unitPriceNet: 2_650, lineTotalNet: 2_650, optional: false },
  ],
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
  payments: [
    { label: "Anzahlung", pct: 50, amount: 15_917.75, dueDate: null },
    { label: "Schlussrechnung", pct: 50, amount: 15_917.7, dueDate: null },
  ],
  skonto: { percent: 0, days: 10 },
  validity: { validUntil: "2026-11-20T10:00:00.000Z" },
  pdfFileId: snapshotFileId.toString(),
  pdfSha256: "issued-pdf-hash",
};

function signedPlanning() {
  return {
    _id: planningId,
    companyId: companyId.toString(),
    customerId,
    projectType: "heating",
    offerSignatureStatus: "signed",
    offerSignedAt: new Date("2026-10-22T10:00:00.000Z"),
    offerSignedPdfFileId: signedFileId,
    offerSignedPdfSha256: "signed-pdf-hash",
    heatingOfferIssuedSnapshot: structuredClone(snapshot),
    commercial: { stage: "offer", valueChf: 99_999 },
    data: {
      profile: { firstName: "Live", buildingStreet: "Changed", buildingZip: "9999" },
      parts: { items: [{ name: "Rohrleitung", quantity: 40, lineTotalNet: 40_000 }] },
      reportOptions: { paymentTerms: "100 %" },
    },
  };
}

test("requires a signed and internally complete Heating issuance", async () => {
  const { assertHeatingOrderPreconditions } = await loadHeatingOrders();
  const planning = signedPlanning();
  assert.equal(assertHeatingOrderPreconditions(planning), planning.heatingOfferIssuedSnapshot);
  assert.throws(
    () => assertHeatingOrderPreconditions({ ...planning, offerSignatureStatus: "viewed" }),
    /unterschrieben/,
  );
  assert.throws(
    () => assertHeatingOrderPreconditions({ ...planning, offerSignedPdfFileId: null }),
    /unvollständig/,
  );
  assert.throws(
    () => assertHeatingOrderPreconditions({ ...planning, projectType: "photovoltaic" }),
    /Heizungsprojekt/,
  );
});

test("builds Heating order context only from the signed snapshot", async () => {
  const { buildHeatingOrderCommercialSummary, buildHeatingOrderDocumentPlanning } = await loadHeatingOrders();
  const planning = signedPlanning();
  const documentPlanning = buildHeatingOrderDocumentPlanning(planning, snapshot);
  const commercial = buildHeatingOrderCommercialSummary(snapshot);

  assert.equal(documentPlanning.data.profile.firstName, "Issued Kunde");
  assert.equal(documentPlanning.data.profile.buildingStreet, "Heizweg");
  assert.equal((documentPlanning.data.parts.items[1] as any).quantity, 18);
  assert.equal(documentPlanning.data.reportOptions.paymentTerms, "50 % / 50 %");
  assert.equal(commercial.grossPriceChf, 31_835.45);
  assert.equal(commercial.items[1].quantity, 18);
  assert.equal(commercial.subsidyChf, 0);
});

test("persists one canonical Heating Auftrag shape with signed-offer linkage", async () => {
  const { buildHeatingAuftragRecord } = await loadHeatingOrders();
  const planning = signedPlanning();
  const now = new Date("2026-10-23T10:00:00.000Z");
  const record = buildHeatingAuftragRecord({
    companyId,
    planningId,
    customerId,
    orderId: "AB-2026-0042",
    planning,
    snapshot,
    orderSnapshotFileId: orderFileId,
    actor: { id: "user-1", fullName: "SOLA Admin" },
    now,
  });

  assert.equal(record.projectType, "heating");
  assert.equal(record.orderId, "AB-2026-0042");
  assert.equal(record.contractTotalGrossChf, 31_835.45);
  assert.equal(record.heatingOrderSnapshot.items[1].quantity, 18);
  assert.equal(record.heatingOrderSnapshot.issuedOffer.signedFileId, signedFileId.toString());
  assert.equal(record.issuedOfferSnapshotFileId?.toString(), snapshotFileId.toString());
  assert.equal(record.signedOfferFileId?.toString(), signedFileId.toString());
  assert.equal(record.orderSnapshotFileId, orderFileId);
  assert.equal("montageId" in record, false);
  assert.equal("stepsState" in record, false);
});

test("Heating generate-order bypasses PV pipeline, invoice and execution side effects", () => {
  const source = readFileSync(
    new URL("../src/app/api/plannings/[planningId]/generate-order/route.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function generateHeatingOrder");
  const end = source.indexOf("export async function OPTIONS", start);
  assert.ok(start >= 0 && end > start);
  const heatingBranch = source.slice(start, end);
  assert.doesNotMatch(
    heatingBranch,
    /createInvoicesForOrderIfMissing|ensureExecutionTasksForWonPlanning|ensureCompanyAuftragPipelineTemplate|persistAuftragStepsState|collection\(["']montages/,
  );
  assert.match(heatingBranch, /nextOrderId/);
  assert.match(heatingBranch, /collection<any>\(["']auftraege["']\)\.insertOne/);
  assert.match(heatingBranch, /orderStatus:\s*["']generated["']/);

  const branch = source.indexOf('resolveProjectType((planning as any)?.projectType) === "heating"');
  const pvPaymentValidation = source.indexOf("normalizePlanningPaymentTerms(planning)");
  assert.ok(branch >= 0 && branch < pvPaymentValidation);
});

test("Heating signature invokes canonical generate-order and keeps failures retryable", () => {
  const source = readFileSync(
    new URL("../src/app/api/public/offer-signature/[token]/sign/route.ts", import.meta.url),
    "utf8",
  );
  const helperStart = source.indexOf("async function generateHeatingOrderFromSignedOffer");
  const helperEnd = source.indexOf("async function deliverOfferAcceptedEmail", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /const orderResponse = await generateOrder/);
  assert.match(helper, /order_generation_failed/);
  assert.match(helper, /retryable:\s*true/);
});
