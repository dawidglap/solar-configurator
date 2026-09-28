import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
import type { Db } from "mongodb";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/invoice-contract-amount-unit-tests";

const loadInvoices = () => import("../src/lib/invoices");
const loadOrderSignatures = () => import("../src/lib/orderSignatures");
const loadPlanningDocuments = () => import("../src/lib/planningDocuments");
const loadSwissQrBill = () => import("../src/lib/swissQrBill");

function catalogOnlyDb() {
  return {
    collection(name: string) {
      assert.equal(name, "catalogItems");
      return { find: () => ({ toArray: async () => [] }) };
    },
  } as unknown as Db;
}

function contractPlanning(manualAdditionalSubsidyChf: number) {
  return {
    companyId: "64f000000000000000000001",
    summary: { dcPowerKw: 0 },
    data: {
      parts: {
        items: [
          {
            category: "service",
            name: "Photovoltaikanlage",
            quantity: 1,
            unitPriceNet: 18_501.39,
            lineTotalNet: 18_501.39,
          },
        ],
      },
      angebot: {
        payments: [
          { label: "Anzahlung", pct: 50 },
          { label: "Zwischenrate", pct: 40 },
          { label: "Schlussrechnung", pct: 10 },
        ],
      },
      reportOptions: {
        mwstIncluded: true,
        discountChf: 0,
        discountPct: 0,
        manualAdditionalSubsidyChf,
      },
    },
  };
}

function pdfContainsText(pdfBytes: Buffer, needle: string) {
  const needleHex = Buffer.from(needle, "latin1").toString("hex").toUpperCase();
  let cursor = 0;
  while (cursor < pdfBytes.length) {
    const streamIndex = pdfBytes.indexOf(Buffer.from("stream"), cursor);
    if (streamIndex === -1) return false;
    let dataStart = streamIndex + "stream".length;
    if (pdfBytes[dataStart] === 0x0d && pdfBytes[dataStart + 1] === 0x0a) dataStart += 2;
    else if (pdfBytes[dataStart] === 0x0a || pdfBytes[dataStart] === 0x0d) dataStart += 1;
    const dataEnd = pdfBytes.indexOf(Buffer.from("endstream"), dataStart);
    if (dataEnd === -1) return false;
    const compressed = pdfBytes.subarray(dataStart, dataEnd);
    const candidates = [compressed];
    try {
      candidates.push(inflateSync(compressed));
    } catch {}
    if (candidates.some((candidate) => candidate.toString("latin1").toUpperCase().includes(needleHex))) {
      return true;
    }
    cursor = dataEnd + "endstream".length;
  }
  return false;
}

test("contract gross remains CHF 20'000 with or without a CHF 3'000 subsidy", async () => {
  const { computePlanningCommercialSummary } = await loadPlanningDocuments();
  const withoutSubsidy = await computePlanningCommercialSummary(
    catalogOnlyDb(),
    contractPlanning(0),
  );
  const withSubsidy = await computePlanningCommercialSummary(
    catalogOnlyDb(),
    contractPlanning(3_000),
  );

  assert.equal(withoutSubsidy.grossPriceChf, 20_000);
  assert.equal(withoutSubsidy.totalInvestmentChf, 20_000);
  assert.equal(withSubsidy.grossPriceChf, 20_000);
  assert.equal(withSubsidy.subsidyChf, 3_000);
  assert.equal(withSubsidy.totalInvestmentChf, 17_000);
});

test("Teilrechnungen allocate the contractual gross without double billing", async () => {
  const { normalizeSignaturePayments } = await loadOrderSignatures();
  const payments = normalizeSignaturePayments(contractPlanning(3_000), 20_000);
  assert.deepEqual(
    payments.map((payment) => payment.amount),
    [10_000, 8_000, 2_000],
  );
  assert.equal(payments.reduce((sum, payment) => sum + payment.amount, 0), 20_000);
});

test("partial payment, QR amount and reminder base retain the real CHF 15'000 balance", async () => {
  const [{ resolveInvoicePaymentAndDunningState }, { getQrEligibility }] = await Promise.all([
    loadInvoices(),
    loadSwissQrBill(),
  ]);
  const state = resolveInvoicePaymentAndDunningState({
    amount: 20_000,
    status: "versendet",
    paidAmount: 5_000,
    paymentStatus: "teilweise",
  });
  const qr = getQrEligibility({
    invoiceType: "rechnung",
    status: state.status,
    paymentStatus: state.paymentStatus,
    amount: 20_000,
    paidAmount: state.paidAmount,
  });

  assert.equal(state.paymentStatus, "teilweise");
  assert.equal(state.paidAmount, 5_000);
  assert.equal(qr.openAmount, 15_000);

  const reminderRoute = readFileSync(
    new URL("../src/app/api/invoices/[invoiceId]/mahnung/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(reminderRoute, /parentInvoice\?\.amount[\s\S]*parentInvoice\?\.paidAmount/);
});

test("invoice PDF renders CHF 20'000 and QR bill consumes the same persisted amount", async () => {
  const { buildInvoicePdf } = await import("../src/lib/invoicePdf");
  const { getQrEligibility } = await loadSwissQrBill();
  const invoice = {
    invoiceNumber: "RE-CONTRACT-TEST",
    invoiceType: "rechnung",
    status: "entwurf",
    paymentStatus: "offen",
    amount: 20_000,
    paidAmount: 0,
    pct: 100,
    rateIndex: 0,
    currency: "CHF",
    issueDate: new Date("2026-01-01T00:00:00.000Z"),
    dueDate: new Date("2026-01-31T00:00:00.000Z"),
  };
  const rendered = await buildInvoicePdf({
    invoice,
    planning: {
      customerId: "K-1",
      data: { profile: { firstName: "Max", lastName: "Muster" } },
    },
    company: { name: "SOLA Test", qrBill: { enabled: false } },
  });

  assert.equal(pdfContainsText(rendered.pdfBytes, "CHF 20'000.00"), true);
  assert.equal(getQrEligibility(invoice).openAmount, 20_000);

  const invoicePdf = readFileSync(
    new URL("../src/lib/invoicePdf.ts", import.meta.url),
    "utf8",
  );
  const qrBill = readFileSync(
    new URL("../src/lib/swissQrBill.ts", import.meta.url),
    "utf8",
  );
  const planningDocuments = readFileSync(
    new URL("../src/lib/planningDocuments.ts", import.meta.url),
    "utf8",
  );

  assert.match(planningDocuments, /totalInklMwst: grossPriceChf/);
  assert.match(invoicePdf, /const amountLabel = `[\s\S]*args\.invoice\?\.amount/);
  assert.match(invoicePdf, /totalAmountChf: roundChf05\(safeNumber\(args\.invoice\?\.amount, 0\)\)/);
  assert.match(qrBill, /amount: roundChf05\(eligibility\.openAmount\)/);
});

test("already issued invoices are excluded from retroactive synchronization", () => {
  const invoices = readFileSync(
    new URL("../src/lib/invoices.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    invoices,
    /normalizeInvoiceStatus\(invoice\?\.status\) !== "entwurf"[\s\S]*Bereits ausgegebene Rechnungen können nicht synchronisiert werden/,
  );
});
