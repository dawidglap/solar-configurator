import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "mongodb";
import { allocateChf05, formatChf05, roundChf05, sumChf05 } from "../src/lib/chf";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/chf-rounding-unit-tests";

test("rounds CHF amounts to 5 Rappen and sums rounded lines", () => {
  assert.equal(roundChf05(14_513.59), 14_513.6);
  assert.equal(roundChf05(14_513.57), 14_513.55);
  assert.match(formatChf05(14_513.59), /^14[’']513\.60$/);
  assert.equal(sumChf05([100.02, 200.03]), 300.05);
});

test("allocates the final payment as remainder so rates add up", () => {
  const payments = allocateChf05(100.05, [50, 50]);
  assert.deepEqual(payments, [50.05, 50]);
  assert.equal(sumChf05(payments), 100.05);
});

test("ANG-2026-3499 summary includes VAT in the effective customer investment", async () => {
  const { buildReportSummary } = await import(
    "../src/app/api/plannings/[planningId]/report-summary/route"
  );
  const planning = {
    planningNumber: "ANG-2026-3499",
    companyId: "64f000000000000000000001",
    summary: { dcPowerKw: 12.9 },
    data: {
      parts: {
        items: [
          {
            category: "service",
            quantity: 1,
            unitPriceNet: 17_722.2,
            lineTotalNet: 17_722.2,
          },
        ],
      },
      reportOptions: {
        mwstIncluded: true,
        paymentTerms: "100 %",
        discountChf: 0,
        discountPct: 0,
        manualAdditionalSubsidyChf: 0.1,
      },
      ist: { electricityUsageKwh: 8_000 },
    },
  };

  const summary = buildReportSummary(planning, []);
  assert.equal(summary.grossInvestmentChf, 17_722.2);
  assert.equal(summary.netInvestmentBeforeSubsidyChf, 17_722.2);
  assert.equal(summary.vatChf, 1_435.5);
  assert.equal(summary.automaticPvSubsidyChf, 4_644);
  assert.equal(summary.manualAdditionalSubsidyChf, 0.1);
  assert.equal(summary.subsidyChf, 4_644.1);
  assert.equal(summary.totalInvestmentChf, 14_513.6);
  assert.deepEqual(summary.payments, [
    { label: "Schlussrechnung", pct: 100, amountChf: 14_513.6 },
  ]);

  const { computePlanningCommercialSummary } = await import("../src/lib/planningDocuments");
  const db = {
    collection(name: string) {
      assert.equal(name, "catalogItems");
      return { find: () => ({ toArray: async () => [] }) };
    },
  } as unknown as Db;
  const commercial = await computePlanningCommercialSummary(db, planning);
  assert.equal(commercial.vatAmountChf, 1_435.5);
  assert.equal(commercial.totalInvestmentChf, 14_513.6);
});
