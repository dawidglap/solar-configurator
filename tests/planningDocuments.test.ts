import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { Db } from "mongodb";
import { PDFDocument } from "pdf-lib";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/planning-documents-unit-tests";

const execFileAsync = promisify(execFile);
const COMPANY_ID = "64f000000000000000000001";
const CUSTOMER_ID = "64f000000000000000000002";

function documentDb(options: { customers?: any[]; catalogItems?: any[] } = {}) {
  return {
    collection(name: string) {
      if (name === "catalogItems") {
        return {
          find() {
            return { toArray: async () => options.catalogItems ?? [] };
          },
        };
      }
      if (name === "customers") {
        return {
          findOne: async (query: any) =>
            options.customers?.find((customer) => String(customer._id) === String(query?._id)) ?? null,
        };
      }
      return { findOne: async () => null };
    },
  } as unknown as Db;
}

async function extractPdfText(bytes: Uint8Array) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sola-offer-pdf-"));
  const file = path.join(dir, "offer.pdf");
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"]);
    return stdout.replace(/\s+/g, " ").trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractPdfBbox(bytes: Uint8Array) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sola-offer-pdf-bbox-"));
  const file = path.join(dir, "offer.pdf");
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-bbox", file, "-"]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pvPlanning(overrides: Record<string, unknown> = {}) {
  return {
    _id: "64f000000000000000000010",
    companyId: COMPANY_ID,
    planningNumber: "ANG-PV-001",
    title: "Photovoltaikanlage Musterhaus",
    summary: {
      customerName: "Dawid Solar",
      moduleCount: 25,
      dcPowerKw: 10,
      roofCount: 1,
    },
    data: {
      profile: {
        firstName: "Dawid",
        lastName: "Solar",
        buildingStreet: "Solarweg",
        buildingStreetNo: "1",
        buildingZip: "8000",
        buildingCity: "Zürich",
      },
      parts: {
        items: [
          {
            id: "pv-module",
            category: "module",
            name: "SOLA Modul 400 Wp",
            quantity: 25,
            unitLabel: "Stk.",
            unitPriceNet: 400,
            lineTotalNet: 10_000,
          },
        ],
        reportSections: {
          projektuebersicht: false,
          technischeEckdaten: true,
          analyse: false,
        },
      },
      reportOptions: {
        mwstIncluded: true,
        paymentTerms: "50 % / 50 %",
      },
    },
    ...overrides,
  };
}

function heatingPlanning(overrides: Record<string, unknown> = {}) {
  return {
    _id: "64f000000000000000000020",
    companyId: COMPANY_ID,
    customerId: CUSTOMER_ID,
    projectType: "heating",
    planningNumber: "ANG-H-001",
    title: "Legacy Photovoltaik title must not leak",
    summary: {
      customerName: "Falscher PV Kunde",
      moduleCount: 44,
      dcPowerKw: 19.8,
      roofCount: 3,
      selectedPanelId: "stale-module",
      snowProtection: { totalLengthM: 99, byRoof: [{ roofId: "pv-roof", lengthM: 99 }] },
    },
    data: {
      profile: {
        firstName: "Dawid",
        lastName: "Heizung",
        buildingStreet: "Heizweg",
        buildingStreetNo: "7",
        buildingZip: "9000",
        buildingCity: "St. Gallen",
      },
      planner: {
        snapshot: { address: "Falsche PV-Adresse 99, 8000 Zürich" },
        snowProtection: {
          quantityMode: "manual",
          manualSegments: [{ id: "stale-snow", roofId: "pv-roof", lengthM: 99 }],
        },
      },
      parts: {
        items: [
          {
            id: "heat-pump",
            category: "Heizung",
            name: "Wärmepumpe SOLA Therm 12",
            quantity: 1,
            unitLabel: "Stk.",
            unitPriceNet: 10_000,
            lineTotalNet: 10_000,
            longDescription: "Luft-Wasser-Wärmepumpe",
            features: ["Leiser Betrieb"],
          },
          {
            id: "heating-installation",
            category: "Dienstleistung",
            name: "Montage Heizsystem",
            quantity: 1,
            unitLabel: "Pauschal",
            unitPriceNet: 2_000,
            lineTotalNet: 2_000,
          },
          {
            id: "optional-boiler",
            category: "Option",
            name: "Optionaler Warmwasserspeicher",
            quantity: 1,
            unitLabel: "Stk.",
            unitPriceNet: 3_000,
            lineTotalNet: 3_000,
            optional: true,
          },
        ],
        reportSections: {
          projektuebersicht: true,
          technischeEckdaten: true,
          analyse: true,
        },
        formDocuments: { vollmacht: true },
      },
      reportOptions: {
        mwstIncluded: true,
        discountPct: 10,
        discountChf: 0,
        additionalSubsidyChf: 9_999,
        manualAdditionalSubsidyChf: 8_888,
        paymentTerms: "50 % / 50 %",
        skontoPct: 2,
      },
      ist: {
        roofType: "Satteldach",
        electricityUsageKwh: 12_000,
      },
    },
    ...overrides,
  };
}

const company = {
  _id: COMPANY_ID,
  name: "SOLA Energie AG",
  pdfSettings: { showFooter: true, footerCompanyName: "SOLA Energie AG" },
};

test("photovoltaic offer PDF preserves the existing document semantics", async () => {
  const { buildPlanningDocumentPdf } = await import("../src/lib/planningDocuments");
  const result = await buildPlanningDocumentPdf({
    db: documentDb(),
    planning: pvPlanning(),
    company,
    session: { activeCompanyId: COMPANY_ID, name: "PV Berater" },
    documentType: "angebot",
  });

  const loaded = await PDFDocument.load(result.pdfBytes);
  const text = await extractPdfText(result.pdfBytes);

  assert.equal(loaded.getSubject(), "Angebot für eine Photovoltaikanlage");
  assert.match(text, /Photovoltaik-Anlage/);
  assert.match(text, /10[.,]00 kWp/);
  assert.match(text, /25 Module/);
  assert.match(text, /Pronovo Einmalvergütung/);
  assert.match(text, /SOLA Modul 400 Wp/);
  assert.match(text, /MWST 8[.,]1 %/);
  assert.match(text, /Total inkl\. MWST\./);
  assert.match(text, /50 % \/ 50 %/);
  assert.equal(result.pricing.totalInklMwst, 10_810);
  assert.equal(result.pricing.totalInvestmentChf, 7_210);
});

test("legacy planning without projectType keeps the photovoltaic fallback", async () => {
  const [{ resolveProjectType }, { buildPlanningDocumentPdf }] = await Promise.all([
    import("../src/lib/projectType"),
    import("../src/lib/planningDocuments"),
  ]);
  const planning = pvPlanning();
  assert.equal("projectType" in planning, false);
  assert.equal(resolveProjectType((planning as any).projectType), "photovoltaic");

  const result = await buildPlanningDocumentPdf({
    db: documentDb(),
    planning,
    company,
    session: { activeCompanyId: COMPANY_ID, name: "PV Berater" },
    documentType: "angebot",
  });
  const loaded = await PDFDocument.load(result.pdfBytes);
  assert.equal(loaded.getSubject(), "Angebot für eine Photovoltaikanlage");
});

test("heating commercial summary ignores stale PV subsidy and snow reconciliation", async () => {
  const { computePlanningCommercialSummary } = await import("../src/lib/planningDocuments");
  const planning = heatingPlanning();
  const commercial = await computePlanningCommercialSummary(
    documentDb({
      catalogItems: [
        {
          _id: "64f000000000000000000099",
          category: "mounting",
          name: "Schneefang",
          unitLabel: "m",
          priceNet: 100,
          metadata: { plannerRole: "snow_protection" },
        },
      ],
    }),
    planning,
  );

  assert.equal(commercial.projectType, "heating");
  assert.deepEqual(
    commercial.items.map((item: any) => item.id),
    ["heat-pump", "heating-installation", "optional-boiler"],
  );
  assert.equal(commercial.partsTotalNet, 12_000);
  assert.equal(commercial.optionalTotalChf, 3_000);
  assert.equal(commercial.netAfterDiscountChf, 10_800);
  assert.equal(commercial.vatAmountChf, 874.8);
  assert.equal(commercial.grossPriceChf, 11_674.8);
  assert.equal(commercial.automaticPvSubsidyChf, 0);
  assert.equal(commercial.manualAdditionalSubsidyChf, 0);
  assert.equal(commercial.subsidyChf, 0);
  assert.equal(commercial.totalInvestmentChf, 11_674.8);
  assert.equal(commercial.effectiveCostChf, 11_674.8);
});

test("heating offer PDF is commercial-only and keeps optional rows outside the total", async () => {
  const { buildPlanningDocumentPdf } = await import("../src/lib/planningDocuments");
  const result = await buildPlanningDocumentPdf({
    db: documentDb({
      customers: [{ _id: CUSTOMER_ID, companyId: COMPANY_ID, name: "Gemeinsamer Kunde" }],
    }),
    planning: heatingPlanning(),
    company,
    session: { activeCompanyId: COMPANY_ID, name: "Heizungsberater" },
    documentType: "angebot",
  });

  const loaded = await PDFDocument.load(result.pdfBytes);
  const text = await extractPdfText(result.pdfBytes);

  assert.equal(loaded.getTitle(), "Heizungsangebot ANG-H-001");
  assert.equal(loaded.getSubject(), "Angebot für eine Heizungsanlage");
  assert.match(text, /Heizungsangebot/);
  assert.match(text, /Dawid Heizung/);
  assert.match(text, /Heizweg 7/);
  assert.match(text, /9000 St\. Gallen/);
  assert.match(text, /Wärmepumpe SOLA Therm 12/);
  assert.match(text, /Montage Heizsystem/);
  assert.match(text, /Optionaler Warmwasserspeicher/);
  assert.match(text, /Optionale Positionen/);
  assert.match(text, /nicht im Total enthalten/);
  assert.match(text, /Netto/);
  assert.match(text, /MWST 8[.,]1 %/);
  assert.match(text, /Brutto inkl\. MWST\./);
  assert.match(text, /50 % \/ 50 %/);
  assert.match(text, /Angebot gültig bis/);
  assert.doesNotMatch(text, /Luft-Wasser-Wärmepumpe|Leiser Betrieb/);
  assert.doesNotMatch(
    text,
    /Photovoltaik|PV-Anlage|kWp|Module|Wechselrichter|Förderung|Förderbeitrag|Schneefang|Vollmacht|Analyse/,
  );
  assert.equal(result.pricing.totalInklMwst, 11_674.8);
  assert.equal(result.pricing.totalInvestmentChf, 11_674.8);
  assert.equal(result.pricing.effectiveCostChf, 11_674.8);
});

test("heating offer PDF keeps imported rows compact and splits explicit customer details safely", async () => {
  const { buildPlanningDocumentPdf } = await import("../src/lib/planningDocuments");
  const planning: any = heatingPlanning();
  const customerDetailTokens = Array.from(
    { length: 520 },
    (_, index) => `CUSTOMERLINE${String(index + 1).padStart(4, "0")}`,
  );

  planning.data.parts.items = Array.from({ length: 65 }, (_, index) => {
    const position = index + 1;
    const explicitlyIncluded = position === 33;
    const zeroPrice = position === 10;
    return {
      id: `heating-${position}`,
      category: index % 2 === 0 ? "Heizung" : "Installation",
      brand: index % 3 === 0 ? "SOLA" : "",
      model: index % 3 === 0 ? `HT-${position}` : "",
      name: `HeatingItem${String(position).padStart(3, "0")}${
        position % 7 === 0 ? " Wärmepumpen-Komplettsystem" : ""
      }`,
      quantity: 1,
      unitLabel: ["Stk.", "MAL", "Set"][index % 3],
      unitPriceNet: zeroPrice ? 0 : 100 + position,
      lineTotalNet: zeroPrice ? 0 : 100 + position,
      optional: position === 65,
      sourcePosition: `SOURCE-POS-${position}`,
      articleNumber: `SUPPLIER-ARTICLE-${position}`,
      importedFromOffer: true,
      importSourceDescription: `NEVER-PRINT-SOURCE-DESCRIPTION-${position}`,
      longDescription: explicitlyIncluded
        ? customerDetailTokens.join(" ")
        : `SUPPLIER-DUMP-LONG-DESCRIPTION-${position}`,
      features: explicitlyIncluded ? ["CUSTOMER-FACING-FEATURE"] : [],
      notes: explicitlyIncluded ? "CUSTOMER-FACING-NOTE" : `SUPPLIER-NOTE-${position}`,
      includeDescriptionInOffer: explicitlyIncluded,
    };
  });

  const result = await buildPlanningDocumentPdf({
    db: documentDb(),
    planning,
    company,
    session: { activeCompanyId: COMPANY_ID, name: "Heizungsberater" },
    documentType: "angebot",
  });
  const loaded = await PDFDocument.load(result.pdfBytes);
  const [text, bbox] = await Promise.all([
    extractPdfText(result.pdfBytes),
    extractPdfBbox(result.pdfBytes),
  ]);

  let previousItemOffset = -1;
  for (let position = 1; position <= 65; position += 1) {
    const itemName = `HeatingItem${String(position).padStart(3, "0")}`;
    assert.equal((text.match(new RegExp(itemName, "g")) || []).length, 1);
    const itemOffset = text.indexOf(itemName);
    assert.ok(itemOffset > previousItemOffset, `${itemName} is out of order`);
    previousItemOffset = itemOffset;
  }
  assert.match(text, /CUSTOMERLINE0001/);
  assert.match(text, /CUSTOMERLINE0520/);
  assert.match(text, /CUSTOMER-FACING-FEATURE/);
  assert.match(text, /CUSTOMER-FACING-NOTE/);
  assert.match(text, /HeatingItem010/);
  assert.match(text, /0[.,]00 CHF/);
  assert.match(text, /Position 33 \(Fortsetzung\)/);
  assert.doesNotMatch(
    text,
    /NEVER-PRINT-SOURCE-DESCRIPTION|SUPPLIER-DUMP-LONG-DESCRIPTION|SUPPLIER-NOTE|SOURCE-POS|SUPPLIER-ARTICLE/,
  );
  assert.ok(loaded.getPageCount() > 4);
  assert.ok(loaded.getPageCount() < 15);
  assert.equal(result.pricing.totalInklMwst, 8_143.15);
  assert.equal(result.pricing.totalInvestmentChf, 8_143.15);

  const detailWords = [...bbox.matchAll(
    /<word\s+xMin="[^"]+"\s+yMin="[^"]+"\s+xMax="[^"]+"\s+yMax="([^"]+)">CUSTOMERLINE\d+<\/word>/g,
  )];
  assert.ok(detailWords.length >= 500);
  for (const match of detailWords) {
    assert.ok(Number(match[1]) <= 719.9, `detail text crossed footer boundary at yMax=${match[1]}`);
  }

  const qaOutput = process.env.HEATING_OFFER_QA_OUTPUT;
  if (qaOutput) {
    await mkdir(path.dirname(qaOutput), { recursive: true });
    await writeFile(qaOutput, result.pdfBytes);
  }
});

test("same customer PV and heating projects keep document identity, address and positions separate", async () => {
  const { buildPlanningDocumentPdf } = await import("../src/lib/planningDocuments");
  const sharedDb = documentDb({
    customers: [{ _id: CUSTOMER_ID, companyId: COMPANY_ID, name: "Gemeinsamer Kunde" }],
  });
  const pv = pvPlanning({ customerId: CUSTOMER_ID });
  const heating = heatingPlanning();

  const [pvResult, heatingResult] = await Promise.all([
    buildPlanningDocumentPdf({
      db: sharedDb,
      planning: pv,
      company,
      session: { activeCompanyId: COMPANY_ID, name: "Berater" },
      documentType: "angebot",
    }),
    buildPlanningDocumentPdf({
      db: sharedDb,
      planning: heating,
      company,
      session: { activeCompanyId: COMPANY_ID, name: "Berater" },
      documentType: "angebot",
    }),
  ]);
  const [pvText, heatingText] = await Promise.all([
    extractPdfText(pvResult.pdfBytes),
    extractPdfText(heatingResult.pdfBytes),
  ]);

  assert.match(pvText, /Photovoltaik-Anlage/);
  assert.match(pvText, /Solarweg 1/);
  assert.match(pvText, /SOLA Modul 400 Wp/);
  assert.doesNotMatch(pvText, /Wärmepumpe SOLA Therm 12|Heizweg 7/);

  assert.match(heatingText, /Heizungsangebot/);
  assert.match(heatingText, /Heizweg 7/);
  assert.match(heatingText, /Wärmepumpe SOLA Therm 12/);
  assert.doesNotMatch(heatingText, /SOLA Modul 400 Wp|Solarweg 1|Photovoltaik/);
});

test("heating order confirmation renders only the signed issuance context", async () => {
  const { buildPlanningDocumentPdf } = await import("../src/lib/planningDocuments");
  const {
    buildHeatingOrderCommercialSummary,
    buildHeatingOrderDocumentPlanning,
  } = await import("../src/lib/heatingOrders");
  const livePlanning = heatingPlanning({
    data: {
      ...heatingPlanning().data,
      profile: {
        firstName: "Live Changed",
        buildingStreet: "Liveweg",
        buildingStreetNo: "99",
        buildingZip: "9999",
        buildingCity: "Liveort",
      },
      parts: {
        ...heatingPlanning().data.parts,
        items: [{ name: "Live Rohrleitung", quantity: 40, lineTotalNet: 40_000 }],
      },
      reportOptions: { paymentTerms: "100 %" },
    },
  });
  const snapshot: any = {
    schemaVersion: 1,
    projectType: "heating",
    planningId: livePlanning._id,
    offerNumber: "ANG-H-SIGNED",
    documentTitle: "Heizungsangebot",
    issuedAt: "2026-10-21T10:00:00.000Z",
    customer: {
      name: "Issued Kunde",
      email: "issued@example.ch",
      phone: null,
      salutation: "herr",
      lastName: "Kunde",
      type: "private",
      companyName: null,
      address: { street: "Rechnungsweg", houseNumber: "3", zip: "3000", city: "Bern" },
    },
    objectAddress: {
      formatted: "Issued Heizweg 7, 3010 Bern",
      street: "Issued Heizweg",
      houseNumber: "7",
      zip: "3010",
      city: "Bern",
    },
    items: [
      { position: 1, category: "Heizung", name: "Issued Wärmepumpe", quantity: 1, unitLabel: "Stk.", unitPriceNet: 25_000, lineTotalNet: 25_000, optional: false },
      { position: 2, category: "Installation", name: "Issued Rohrleitung", quantity: 18, unitLabel: "m", unitPriceNet: 100, lineTotalNet: 1_800, optional: false },
      { position: 3, category: "Installation", name: "Issued Montage", quantity: 1, unitLabel: "Pauschal", unitPriceNet: 2_650, lineTotalNet: 2_650, optional: false },
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
    payments: [],
    skonto: { percent: 0, days: 10 },
    validity: { validUntil: "2026-11-20T10:00:00.000Z" },
    pdfFileId: "64f000000000000000000044",
    pdfSha256: "issued-hash",
  };
  const documentPlanning = buildHeatingOrderDocumentPlanning(livePlanning, snapshot);
  const commercialSummary = buildHeatingOrderCommercialSummary(snapshot);
  const result = await buildPlanningDocumentPdf({
    db: documentDb(),
    planning: documentPlanning,
    company,
    session: { activeCompanyId: COMPANY_ID, name: "Berater" },
    documentType: "auftrag",
    orderId: "AB-2026-0042",
    orderGeneratedAt: new Date("2026-10-23T10:00:00.000Z"),
    issuedAt: new Date("2026-10-23T10:00:00.000Z"),
    commercialSummary,
    sections: { projektuebersicht: false, technischeEckdaten: true, analyse: false },
  });
  const loaded = await PDFDocument.load(result.pdfBytes);
  const text = await extractPdfText(result.pdfBytes);

  assert.equal(loaded.getSubject(), "Auftragsbestätigung für eine Heizungsanlage");
  assert.match(text, /Auftragsbestätigung/);
  assert.match(text, /Heizungsauftrag/);
  assert.match(text, /Issued Kunde/);
  assert.match(text, /Issued Heizweg 7/);
  assert.match(text, /Issued Wärmepumpe/);
  assert.match(text, /Issued Rohrleitung/);
  assert.match(text, /50 % \/ 50 %/);
  assert.equal(result.pricing.totalInklMwst, 31_835.45);
  assert.doesNotMatch(text, /Live Changed|Liveweg|Live Rohrleitung|40'000/);
  assert.doesNotMatch(
    text,
    /Photovoltaik|kWp|Module|Wechselrichter|Förderung|Schneefang|Vollmacht|Netzanschluss|Analyse/,
  );
});
