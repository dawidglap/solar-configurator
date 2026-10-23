import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
import type { Db } from "mongodb";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/heating-invoices-unit-tests";

function contractSnapshot() {
  return {
    schemaVersion: 1,
    projectType: "heating",
    customer: {
      name: "Vertrag Kunde",
      email: "vertrag@example.ch",
      phone: "+41 79 111 22 33",
      salutation: "Herr",
      type: "private",
      companyName: null,
      address: { street: "Vertragsweg", houseNumber: "3", zip: "3000", city: "Bern" },
    },
    objectAddress: { formatted: "Heizweg 7, 3010 Bern", street: "Heizweg", houseNumber: "7", zip: "3010", city: "Bern" },
    items: [{ name: "Wärmepumpe", lineTotalNet: 29_450 }],
    optionalItems: [{ name: "Nicht gewählte Option", lineTotalNet: 99_999 }],
    pricing: { totalGross: 31_835.45, vatRate: 8.1 },
    paymentTerms: "50 % / 50 %",
    payments: [
      { label: "Anzahlung", pct: 50, amount: 15_917.75, dueDate: "2026-11-01" },
      { label: "Schlussrechnung", pct: 50, amount: 15_917.7, dueDate: null },
    ],
  };
}

function auftrag() {
  return {
    companyId: "company-1",
    planningId: "64f000000000000000000201",
    customerId: "64f000000000000000000203",
    orderId: "AB-H-2026-0042",
    projectType: "heating",
    status: "aktiv",
    currency: "CHF",
    heatingOrderSnapshot: contractSnapshot(),
  };
}

function matches(doc: any, query: any) {
  return Object.entries(query).every(([key, value]) => doc?.[key] === value);
}

function fakeDb(seed: any[] = []) {
  const invoices = seed.map((doc, index) => ({ _id: `invoice-${index + 1}`, ...doc }));
  let invoiceId = invoices.length;
  let counter = 0;
  const invoiceCollection = {
    createIndex: async () => "ok",
    findOne: async (query: any) => invoices.find((doc) => matches(doc, query)) ?? null,
    updateOne: async (query: any, update: any, options: any) => {
      const existing = invoices.find((doc) => matches(doc, query));
      if (existing) return { matchedCount: 1, upsertedCount: 0 };
      if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
      invoiceId += 1;
      invoices.push({ _id: `invoice-${invoiceId}`, ...update.$setOnInsert });
      return { matchedCount: 0, upsertedCount: 1 };
    },
    find: (query: any) => ({
      sort: () => ({
        toArray: async () => invoices.filter((doc) => matches(doc, query)).sort((a, b) => a.rateIndex - b.rateIndex),
      }),
    }),
  };
  return {
    db: {
      collection(name: string) {
        if (name === "invoices") return invoiceCollection;
        if (name === "invoice_events") return { createIndex: async () => "ok" };
        if (name === "counters") return {
          findOneAndUpdate: async () => ({ seq: ++counter }),
        };
        throw new Error(`Unexpected collection ${name}`);
      },
    } as unknown as Db,
    invoices,
  };
}

function pdfContainsText(pdfBytes: Buffer, needle: string) {
  const needleHex = Buffer.from(needle, "latin1").toString("hex").toUpperCase();
  let cursor = 0;
  while (cursor < pdfBytes.length) {
    const streamIndex = pdfBytes.indexOf(Buffer.from("stream"), cursor);
    if (streamIndex === -1) return false;
    let start = streamIndex + 6;
    if (pdfBytes[start] === 0x0d && pdfBytes[start + 1] === 0x0a) start += 2;
    else if (pdfBytes[start] === 0x0a || pdfBytes[start] === 0x0d) start += 1;
    const end = pdfBytes.indexOf(Buffer.from("endstream"), start);
    if (end === -1) return false;
    const raw = pdfBytes.subarray(start, end);
    const candidates = [raw];
    try { candidates.push(inflateSync(raw)); } catch {}
    if (candidates.some((candidate) => {
      const text = candidate.toString("latin1");
      return text.includes(needle) || text.toUpperCase().includes(needleHex);
    })) return true;
    cursor = end + 9;
  }
  return false;
}

test("Heating invoice plan uses exact contractual amounts and ignores optional items", async () => {
  const { getHeatingInvoicePlan } = await import("../src/lib/heatingInvoices");
  const plan = getHeatingInvoicePlan(auftrag());
  assert.equal(plan.totalGross, 31_835.45);
  assert.deepEqual(plan.items.map((item: any) => item.amount), [15_917.75, 15_917.7]);
  assert.equal(plan.items.reduce((sum: number, item: any) => sum + item.amount, 0), 31_835.45);
  assert.equal(plan.items[0].label, "Anzahlung");
  assert.equal(plan.items[0].dueDate?.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("explicit creation is idempotent and repairs only a missing contractual rate", async () => {
  const { createHeatingInvoicesForOrder } = await import("../src/lib/heatingInvoices");
  const fake = fakeDb();
  const args = {
    db: fake.db,
    companyId: "company-1",
    auftrag: auftrag(),
    company: { paymentDefaults: { currency: "CHF", termDays: 30 } },
    session: { activeCompanyId: "company-1", userId: "user-1", name: "Admin" } as any,
    now: new Date("2026-10-23T12:00:00.000Z"),
  };

  const first = await createHeatingInvoicesForOrder(args);
  assert.equal(first.createdCount, 2);
  assert.deepEqual(first.invoices.map((invoice) => invoice.amount), [15_917.75, 15_917.7]);
  assert.equal(first.invoices[0].heatingInvoiceSnapshot.customer.name, "Vertrag Kunde");

  const repeated = await createHeatingInvoicesForOrder(args);
  assert.equal(repeated.createdCount, 0);
  assert.equal(repeated.invoices.length, 2);

  fake.invoices.splice(fake.invoices.findIndex((invoice) => invoice.rateIndex === 1), 1);
  const repaired = await createHeatingInvoicesForOrder(args);
  assert.equal(repaired.createdCount, 1);
  assert.equal(repaired.invoices.length, 2);
  assert.equal(repaired.invoices[0].invoiceNumber, first.invoices[0].invoiceNumber);
});

test("Heating PDF recipient and wording stay on the persisted invoice snapshot", async () => {
  const [{ buildInvoicePdf, buildInvoiceDocumentPlanning }, { createHeatingInvoicesForOrder }] = await Promise.all([
    import("../src/lib/invoicePdf"),
    import("../src/lib/heatingInvoices"),
  ]);
  const fake = fakeDb();
  const created = await createHeatingInvoicesForOrder({
    db: fake.db,
    companyId: "company-1",
    auftrag: auftrag(),
    company: { paymentDefaults: { termDays: 30 } },
    session: { activeCompanyId: "company-1" } as any,
    now: new Date("2026-10-23T12:00:00.000Z"),
  });
  const invoice = created.invoices[0];
  const planning = buildInvoiceDocumentPlanning(invoice, {
    data: { profile: { firstName: "Live geändert", street: "Falscher Weg" } },
  });
  assert.equal(planning.data.profile.firstName, "Vertrag Kunde");
  assert.equal(planning.data.profile.street, "Vertragsweg");

  const rendered = await buildInvoicePdf({
    invoice,
    planning: { data: { profile: { firstName: "Live geändert" } } },
    company: { name: "SOLA Test", qrBill: { enabled: false } },
  });
  assert.equal(pdfContainsText(rendered.pdfBytes, "Rechnung Nr. RE-000001"), true);
  assert.equal(pdfContainsText(rendered.pdfBytes, "Vertrag Kunde"), true);
  assert.equal(pdfContainsText(rendered.pdfBytes, "CHF 15'917.75"), true);
  assert.equal(pdfContainsText(rendered.pdfBytes, "01.11.2026"), true);
  assert.equal(pdfContainsText(rendered.pdfBytes, "Heizungsanlage"), true);
  assert.equal(pdfContainsText(rendered.pdfBytes, "Photovoltaik"), false);
});

test("Heating invoice reuses the generic QR bill with snapshot debtor and exact amount", async () => {
  const [{ createInvoiceQrPaymentPart, generateQrReference }, { buildInvoiceDocumentPlanning }] = await Promise.all([
    import("../src/lib/swissQrBill"),
    import("../src/lib/invoicePdf"),
  ]);
  const snapshot = contractSnapshot();
  const invoice = {
    companyId: "company-1",
    planningId: "planning-1",
    customerId: "customer-1",
    orderId: "AB-H-2026-0042",
    projectType: "heating",
    invoiceNumber: "RE-000042",
    invoiceType: "rechnung",
    status: "entwurf",
    paymentStatus: "offen",
    amount: 15_917.75,
    paidAmount: 0,
    rateLabel: "Anzahlung",
    qrReferenceType: "QRR",
    qrReference: generateQrReference("42"),
    heatingInvoiceSnapshot: {
      customer: snapshot.customer,
      objectAddress: snapshot.objectAddress,
      pricing: { totalGross: snapshot.pricing.totalGross, vatRate: snapshot.pricing.vatRate },
    },
  };
  const planning = buildInvoiceDocumentPlanning(invoice, { data: { profile: { firstName: "Live" } } });
  const result = await createInvoiceQrPaymentPart({
    invoice,
    planning,
    company: {
      name: "SOLA Test AG",
      bank: { accountHolder: "SOLA Test AG" },
      qrBill: {
        enabled: true,
        referenceType: "QRR",
        qrIban: "CH44 3199 9123 0008 8901 2",
        creditor: { street: "Solarstrasse", houseNumber: "7", zip: "8000", city: "Zürich", country: "CH" },
      },
    },
  });
  assert.equal(result.qrBillWarning, null);
  assert.ok(result.paymentPartPdfBytes);
});

test("invalid or drifted contractual totals are rejected", async () => {
  const { getHeatingInvoicePlan } = await import("../src/lib/heatingInvoices");
  const invalid = auftrag();
  invalid.heatingOrderSnapshot.payments[1].amount = 10;
  assert.throws(() => getHeatingInvoicePlan(invalid), /Vertragssumme/);
});

test("Heating issuance is explicit, tenant-scoped, and unavailable through manual invoice creation", () => {
  const orderInvoicesRoute = readFileSync(
    new URL("../src/app/api/orders/[orderId]/invoices/route.ts", import.meta.url),
    "utf8",
  );
  const genericInvoicesRoute = readFileSync(
    new URL("../src/app/api/invoices/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(orderInvoicesRoute, /export async function POST/);
  assert.match(orderInvoicesRoute, /companyId:\s*String\(session\.activeCompanyId\)/);
  assert.match(orderInvoicesRoute, /getAuftraegeCollection\(db\)\.findOne\([\s\S]*companyId[\s\S]*projectType:\s*"heating"/);
  assert.match(orderInvoicesRoute, /createHeatingInvoicesForOrder/);
  assert.match(genericInvoicesRoute, /resolveProjectType\([\s\S]*=== "heating"[\s\S]*kanonischen Auftrags- und Rechnungsaktionen/);
});

test("PV and Heating invoices for the same customer remain project/order-scoped", async () => {
  const { createHeatingInvoicesForOrder } = await import("../src/lib/heatingInvoices");
  const pvInvoice = {
    companyId: "company-1",
    planningId: "pv-planning",
    customerId: "64f000000000000000000203",
    orderId: "AB-PV-2026-0001",
    projectType: "photovoltaic",
    invoiceType: "rechnung",
    rateIndex: 0,
    invoiceNumber: "RE-PV-EXISTING",
    amount: 9_999,
  };
  const fake = fakeDb([pvInvoice]);
  const first = auftrag();
  const second = auftrag();
  second.orderId = "AB-H-2026-0043";
  second.planningId = "64f000000000000000000204";
  const common = {
    db: fake.db,
    companyId: "company-1",
    company: {},
    session: { activeCompanyId: "company-1" } as any,
    now: new Date("2026-10-23T12:00:00.000Z"),
  };
  await createHeatingInvoicesForOrder({ ...common, auftrag: first });
  await createHeatingInvoicesForOrder({ ...common, auftrag: second });
  assert.equal(fake.invoices.filter((invoice) => invoice.orderId === first.orderId).length, 2);
  assert.equal(fake.invoices.filter((invoice) => invoice.orderId === second.orderId).length, 2);
  assert.deepEqual(fake.invoices.find((invoice) => invoice.orderId === pvInvoice.orderId), {
    _id: "invoice-1",
    ...pvInvoice,
  });
  assert.equal(new Set(fake.invoices.map((invoice) => invoice.invoiceNumber)).size, 5);
});
