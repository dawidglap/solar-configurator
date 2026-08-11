import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "mongodb";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/optional-positions-unit-tests";

const loadReport = () =>
  import("../src/app/api/plannings/[planningId]/report-summary/route");
const loadDocuments = () => import("../src/lib/planningDocuments");
const loadOfferSignatures = () => import("../src/lib/offerSignatures");
const loadOrderSignatures = () => import("../src/lib/orderSignatures");

const requiredItem = {
  id: "pv-system",
  category: "service",
  name: "Photovoltaikanlage",
  quantity: 1,
  unitLabel: "Pauschal",
  unitPriceNet: 33_000,
  lineTotalNet: 33_000,
  costNet: 25_000,
};

const optionalItem = {
  id: "battery-option",
  category: "speicher",
  label: "Speicher 10 kWh",
  name: "HVM 10.2",
  brand: "BYD",
  note: "inkl. Montage",
  quantity: 1,
  unitLabel: "Stk.",
  unitPriceNet: 5_000,
  lineTotalNet: 5_000,
  costNet: 4_900,
  optional: true,
};

function planningWith(items: any[]) {
  return {
    companyId: "64f000000000000000000001",
    summary: { dcPowerKw: 0 },
    data: {
      parts: { items },
      reportOptions: {
        mwstIncluded: false,
        discountChf: 0,
        discountPct: 0,
        manualAdditionalSubsidyChf: 0,
        skontoPct: 2,
      },
      ist: {
        electricityUsageKwh: 8_000,
      },
    },
  };
}

function catalogOnlyDb() {
  return {
    collection(name: string) {
      assert.equal(name, "catalogItems");
      return {
        find() {
          return { toArray: async () => [] };
        },
      };
    },
  } as unknown as Db;
}

function publicPayloadDb() {
  return {
    collection(name: string) {
      if (name === "catalogItems") {
        return {
          find() {
            return { toArray: async () => [] };
          },
        };
      }
      return { findOne: async () => null };
    },
  } as unknown as Db;
}

test("optional rows do not change report totals, margin, skonto or analysis", async () => {
  const { buildReportSummary } = await loadReport();
  const baseline = buildReportSummary(
    planningWith([requiredItem]),
    [],
  ) as Record<string, unknown>;
  const withOption = buildReportSummary(
    planningWith([requiredItem, optionalItem]),
    [],
  ) as Record<string, unknown>;

  for (const field of [
    "grossInvestmentChf",
    "netInvestmentBeforeSubsidyChf",
    "totalInvestmentChf",
    "totalMargeChf",
    "margePct",
    "skontoValueChf",
    "breakEvenYears",
    "roiPct",
    "annualBenefitChf",
  ]) {
    assert.equal(withOption[field], baseline[field], field);
  }

  assert.equal(withOption.grossInvestmentChf, 33_000);
  assert.equal(withOption.optionalTotalChf, 5_000);
  assert.equal(withOption.optionalItemsCount, 1);
  assert.equal(withOption.includedPartsCount, 1);

  const configuredOptionalBattery = planningWith([requiredItem, optionalItem]);
  (configuredOptionalBattery.data.reportOptions as any).includeBattery = true;
  const optionalBatterySummary = buildReportSummary(
    configuredOptionalBattery,
    [],
  );
  assert.equal(optionalBatterySummary.hasBattery, false);
});

test("commercial summary and signature item shape keep options outside VAT totals", async () => {
  const { computePlanningCommercialSummary } = await loadDocuments();
  const commercial = await computePlanningCommercialSummary(
    catalogOnlyDb(),
    planningWith([requiredItem, optionalItem]),
  );

  assert.equal(commercial.partsTotalNet, 33_000);
  assert.equal(commercial.netAfterDiscountChf, 33_000);
  assert.equal(commercial.vatAmountChf, 0);
  assert.equal(commercial.grossPriceChf, 33_000);
  assert.equal(commercial.effectiveCostChf, 33_000);
  assert.equal(commercial.optionalTotalChf, 5_000);
  assert.deepEqual(commercial.optionalItems, [
    {
      label: "Speicher 10 kWh",
      name: "BYD HVM 10.2",
      note: "inkl. Montage",
      qty: 1,
      unit: "Stk.",
      priceChf: 5_000,
    },
  ]);
});

test("public offer and order signature payloads expose the same optional values", async () => {
  const [{ buildPublicOffer }, { buildPublicSignatureOrder }] = await Promise.all([
    loadOfferSignatures(),
    loadOrderSignatures(),
  ]);
  const planning = {
    ...planningWith([requiredItem, optionalItem]),
    _id: "64f000000000000000000002",
    planningNumber: "OFF-2026-0042",
    orderId: "AUF-2026-0042",
    title: "Photovoltaikanlage Musterhaus",
    offerSignatureStatus: "sent",
    signatureStatus: "sent",
  };
  const req = new Request("https://planner.helionic.ch/api/public/test");
  const db = publicPayloadDb();

  const offer = await buildPublicOffer({ db, planning, token: "offer-token", req });
  const order = await buildPublicSignatureOrder({ db, planning, token: "order-token", req });

  for (const payload of [offer, order]) {
    assert.equal(payload.totalInklMwst, 33_000);
    assert.equal(payload.subsidyChf, 0);
    assert.equal(payload.effectiveCostChf, 33_000);
    assert.equal(payload.optionalTotalChf, 5_000);
    assert.deepEqual(payload.optionalItems, [
      {
        label: "Speicher 10 kWh",
        name: "BYD HVM 10.2",
        note: "inkl. Montage",
        qty: 1,
        unit: "Stk.",
        priceChf: 5_000,
      },
    ]);
  }
});
