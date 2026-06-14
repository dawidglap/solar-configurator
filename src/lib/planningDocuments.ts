import { ObjectId, type Db } from "mongodb";
import { PDFDocument } from "pdf-lib";
import { addCoverPage } from "@/app/api/plannings/[planningId]/offer/pdf/cover-page";
import { addDetailPages } from "@/app/api/plannings/[planningId]/offer/pdf/detail-pages";
import { addProjectOverviewPage } from "@/app/api/plannings/[planningId]/offer/pdf/project-overview-page";
import { addReportPages } from "@/app/api/plannings/[planningId]/offer/pdf/report-pages";
import { buildReportSummary } from "@/app/api/plannings/[planningId]/report-summary/route";
import { safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { getSessionUserMeta } from "@/lib/tasks";

export type PlanningDocumentType = "angebot" | "auftrag";

type PaymentRow = {
  label: string;
  pct: number;
  amountChf: number;
  dueAt: string;
};

type BuildPlanningDocumentPdfArgs = {
  db: Db;
  planning: any;
  company: any;
  session: SessionPayload;
  documentType: PlanningDocumentType;
  orderId?: string | null;
  orderGeneratedAt?: Date | string | null;
};

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStringArray(v: unknown) {
  return Array.isArray(v)
    ? v.map((x) => safeString(x)).filter(Boolean)
    : [];
}

function formatDateCH(date: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function parseDate(value: unknown) {
  if (value instanceof Date) return value;
  const str = safeString(value);
  if (!str) return null;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundToFiveCents(value: number) {
  return Math.round(safeNumber(value, 0) * 20) / 20;
}

function formatIban(value: unknown) {
  const compact = safeString(value).replace(/\s+/g, "").toUpperCase();
  if (!compact) return "";
  return compact.replace(/(.{4})(?=.)/g, "$1 ").trim();
}

function getItemLineTotal(item: any) {
  const directTotal = safeNumber(
    item?.lineTotalNet ??
      item?.lineTotal ??
      item?.lineTotalChf ??
      item?.totalNet ??
      item?.totalChf,
    Number.NaN,
  );

  if (Number.isFinite(directTotal)) {
    return directTotal;
  }

  const qty = safeNumber(item?.quantity ?? item?.qty ?? item?.stk, 0);
  const unitPrice = safeNumber(
    item?.unitPriceNet ??
      item?.unitPrice ??
      item?.einzelpreis ??
      item?.priceNet ??
      item?.priceChf,
    0,
  );

  return qty * unitPrice;
}

function buildCatalogLookupKey(input: {
  category?: unknown;
  brand?: unknown;
  model?: unknown;
  name?: unknown;
}) {
  return [
    safeString(input.category).toLowerCase(),
    safeString(input.brand).toLowerCase(),
    safeString(input.model).toLowerCase(),
    safeString(input.name).toLowerCase(),
  ].join("::");
}

function resolveDocumentType(planning: any, input?: unknown): PlanningDocumentType {
  const normalized = safeString(input).toLowerCase();
  if (normalized === "angebot" || normalized === "auftrag") {
    return normalized;
  }
  return safeString(planning?.orderStatus).toLowerCase() === "generated"
    ? "auftrag"
    : "angebot";
}

function getDocumentIdentifiers(args: {
  planning: any;
  documentType: PlanningDocumentType;
  orderId?: string | null;
}) {
  const orderId = safeString(args.orderId) || safeString(args.planning?.orderId) || "—";
  const planningNumber = safeString(args.planning?.planningNumber) || "—";

  if (args.documentType === "auftrag") {
    return {
      documentTitle: "Auftrag",
      documentNumber: orderId,
      documentNumberLabel: `Auftrag Nr. ${orderId}`,
      fileStem: `Auftrag_${orderId}`,
    };
  }

  return {
    documentTitle: "Angebot",
    documentNumber: planningNumber,
    documentNumberLabel: `Offerte Nr. ${planningNumber}`,
    fileStem: `Angebot_${planningNumber}`,
  };
}

function extractPaymentsSource(data: any) {
  return (
    data?.angebot?.payments ??
    data?.offer?.payments ??
    data?.reportOptions?.payments ??
    []
  );
}

function buildPaymentRows(args: {
  planning: any;
  company: any;
  totalInklMwst: number;
  orderGeneratedAt?: Date | string | null;
}) {
  const data = args.planning?.data ?? {};
  const rows = Array.isArray(extractPaymentsSource(data))
    ? extractPaymentsSource(data)
    : [];
  const baseDate = parseDate(args.orderGeneratedAt) ?? new Date();
  const defaultTermDays = Math.max(
    0,
    safeNumber(args.company?.paymentDefaults?.termDays, 30),
  );

  return rows
    .map((row: any, index: number): PaymentRow | null => {
      const pct = safeNumber(
        row?.pct ?? row?.percent ?? row?.percentage ?? row?.sharePct,
        Number.NaN,
      );
      if (!Number.isFinite(pct) || pct <= 0) return null;

      const amountChf = roundToFiveCents((args.totalInklMwst * pct) / 100);
      const label =
        safeString(row?.label) ||
        safeString(row?.name) ||
        `Rate ${index + 1}`;

      const explicitDueDate = parseDate(row?.dueAt ?? row?.dueDate ?? row?.date);
      const termDays = safeNumber(row?.termDays ?? row?.days, defaultTermDays);
      const computedDueDate = new Date(baseDate);
      computedDueDate.setDate(computedDueDate.getDate() + Math.max(0, termDays));

      return {
        label,
        pct,
        amountChf,
        dueAt: formatDateCH(explicitDueDate ?? computedDueDate),
      };
    })
    .filter((row: PaymentRow | null): row is PaymentRow => !!row);
}

export async function computePlanningCommercialSummary(db: Db, planning: any) {
  const data = planning?.data ?? {};
  const parts = data?.parts ?? {};
  const reportOptions = data?.reportOptions ?? {};
  const summary = planning?.summary ?? {};
  const items = Array.isArray(parts?.items) ? parts.items : [];

  const catalogDocs = await db
    .collection("catalogItems")
    .find({
      companyId: planning?.companyId,
      isActive: true,
    })
    .toArray();

  const reportSummary = buildReportSummary(planning, catalogDocs);

  const partsTotalNet = Number(
    items.reduce((sum: number, item: any) => sum + getItemLineTotal(item), 0).toFixed(2),
  );

  const discountChf = safeNumber(
    reportSummary?.discountChf ?? reportOptions?.discountChf,
    0,
  );
  const discountPct = safeNumber(
    reportSummary?.discountPct ?? reportOptions?.discountPct,
    0,
  );
  const discountFromPctChf = Number(
    (
      reportSummary?.discountFromPctChf ??
      (partsTotalNet * discountPct) / 100
    ).toFixed(2),
  );
  const totalDiscountChf = Number(
    (
      reportSummary?.totalDiscountChf ??
      (discountChf + discountFromPctChf)
    ).toFixed(2),
  );
  const netAfterDiscountChf = Number(
    Math.max(0, partsTotalNet - totalDiscountChf).toFixed(2),
  );
  const vatRatePct = 8.1;
  const vatAmountChf = Number((netAfterDiscountChf * (vatRatePct / 100)).toFixed(2));
  const grossPriceChf = Number((netAfterDiscountChf + vatAmountChf).toFixed(2));

  const dcPowerKw = safeNumber(summary?.dcPowerKw, 0);
  const automaticPvSubsidyChf = safeNumber(
    reportSummary?.automaticPvSubsidyChf,
    dcPowerKw <= 0 ? 0 : dcPowerKw <= 30 ? dcPowerKw * 360 : dcPowerKw * 300,
  );
  const manualAdditionalSubsidyChf = safeNumber(
    reportSummary?.manualAdditionalSubsidyChf ?? reportOptions?.additionalSubsidyChf,
    0,
  );
  const subsidyChf = Number(
    (automaticPvSubsidyChf + manualAdditionalSubsidyChf).toFixed(2),
  );
  const totalInvestmentChf = Number(
    Math.max(0, grossPriceChf - subsidyChf).toFixed(2),
  );
  const taxSavingsChf = safeNumber((reportSummary as any)?.taxSavingsChf, 0);
  const effectiveCostChf = Number(
    Math.max(0, totalInvestmentChf - taxSavingsChf).toFixed(2),
  );

  return {
    catalogDocs,
    reportSummary,
    partsTotalNet,
    discountChf,
    discountPct,
    discountFromPctChf,
    totalDiscountChf,
    netAfterDiscountChf,
    vatRatePct,
    vatAmountChf,
    grossPriceChf,
    automaticPvSubsidyChf,
    manualAdditionalSubsidyChf,
    subsidyChf,
    totalInvestmentChf,
    taxSavingsChf,
    effectiveCostChf,
  };
}

export async function buildPlanningDocumentPdf(args: BuildPlanningDocumentPdfArgs) {
  const { db, planning, company, session, documentType } = args;
  const users = db.collection("users");
  const snapshotCache = db.collection("snapshotCache");

  const sessionUserId = safeString(session?.userId);
  const user = sessionUserId
    ? await users.findOne({ _id: toObjectIdOrNull(sessionUserId) ?? new ObjectId() })
    : null;

  const companyName = safeString(company?.name) || "Ihre Firma";
  const advisorMeta = getSessionUserMeta(session);
  const advisorName =
    [safeString(user?.firstName), safeString(user?.lastName)]
      .filter(Boolean)
      .join(" ") ||
    advisorMeta.name ||
    companyName;

  const data = planning?.data ?? {};
  const profile = data?.profile ?? {};
  const parts = data?.parts ?? {};
  const summary = planning?.summary ?? {};
  const items = Array.isArray(parts?.items) ? parts.items : [];

  const {
    catalogDocs,
    reportSummary,
    partsTotalNet,
    discountChf,
    discountPct,
    discountFromPctChf,
    totalDiscountChf,
    netAfterDiscountChf,
    vatRatePct,
    vatAmountChf,
    grossPriceChf,
    automaticPvSubsidyChf,
    manualAdditionalSubsidyChf,
    subsidyChf,
    totalInvestmentChf,
    taxSavingsChf,
    effectiveCostChf,
  } = await computePlanningCommercialSummary(db, planning);

  const catalogById = new Map<string, any>();
  const catalogByCompositeKey = new Map<string, any>();

  for (const doc of catalogDocs) {
    const id = String(doc?._id ?? "");
    if (id) {
      catalogById.set(id, doc);
    }

    const key = buildCatalogLookupKey({
      category: doc?.category,
      brand: doc?.brand,
      model: doc?.model,
      name: doc?.name,
    });

    if (key && !catalogByCompositeKey.has(key)) {
      catalogByCompositeKey.set(key, doc);
    }
  }

  const enrichedItems = items.map((item: any) => {
    const catalogItemId =
      safeString(item?.catalogItemId) ||
      safeString(item?.catalogId) ||
      safeString(item?.sourceCatalogItemId) ||
      safeString(item?.itemId) ||
      "";

    let catalogDoc = catalogItemId ? catalogById.get(catalogItemId) : null;

    if (!catalogDoc) {
      const fallbackKey = buildCatalogLookupKey({
        category: item?.category ?? item?.kategorie,
        brand: item?.brand ?? item?.marke,
        model: item?.model,
        name: item?.name ?? item?.beschreibung,
      });
      catalogDoc = fallbackKey ? catalogByCompositeKey.get(fallbackKey) : null;
    }

    return {
      ...item,
      catalogItemId: catalogItemId || (catalogDoc ? String(catalogDoc._id) : ""),
      pdfSection: safeString(catalogDoc?.pdfSection),
      catalogDescription: safeString(catalogDoc?.description),
      catalogLongDescription: safeString(catalogDoc?.longDescription),
      catalogFeatures: safeStringArray(catalogDoc?.features),
      catalogWarranty: safeString(catalogDoc?.warranty),
      catalogCompatibility: safeString(catalogDoc?.compatibility),
      catalogNotes: safeString(catalogDoc?.notes),
    };
  });

  const dcPowerKw = safeNumber(summary?.dcPowerKw, 0);
  const today = new Date();
  const validUntilDate = new Date(today);
  validUntilDate.setDate(validUntilDate.getDate() + 30);
  const todayFormatted = formatDateCH(today);
  const validUntilFormatted = formatDateCH(validUntilDate);

  const customerName =
    [safeString(profile?.firstName), safeString(profile?.lastName)]
      .filter(Boolean)
      .join(" ") ||
    safeString(profile?.companyName) ||
    safeString(summary?.customerName) ||
    "—";

  const customerSalutation = safeString(
    profile?.salutation ?? profile?.title ?? profile?.gender,
  ).toLowerCase();
  const customerLastName = safeString(profile?.lastName ?? profile?.contactLastName);
  const customerType = safeString(profile?.type ?? profile?.customerType).toLowerCase();

  const batteryItems = items.filter((item: any) => {
    const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
    return category === "batterie" || category === "battery" || category === "speicher";
  });
  const wallboxItems = items.filter((item: any) => {
    const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
    return category === "ladestation" || category === "wallbox";
  });

  const batteryItem = batteryItems[0];
  const wallboxItem = wallboxItems[0];
  const batteryPriceChf = Number(
    batteryItems.reduce((sum: number, item: any) => sum + getItemLineTotal(item), 0).toFixed(2),
  );
  const wallboxPriceChf = Number(
    wallboxItems.reduce((sum: number, item: any) => sum + getItemLineTotal(item), 0).toFixed(2),
  );
  const baseSystemNetChf = Number(
    Math.max(0, partsTotalNet - batteryPriceChf - wallboxPriceChf).toFixed(2),
  );

  const identifiers = getDocumentIdentifiers({
    planning,
    documentType,
    orderId: args.orderId,
  });

  const offer = {
    title: safeString(planning?.title) || "Photovoltaik-Angebot",
    planningNumber: safeString(planning?.planningNumber) || "—",
    pv: {
      dcPowerKw,
      moduleCount: safeNumber(summary?.moduleCount, 0),
    },
    customer: {
      name: customerName,
    },
    companyName,
    pricing: {
      netSystemPriceChf: baseSystemNetChf,
      discountChf,
      discountPct,
      discountFromPctChf,
      totalDiscountChf,
      netAfterDiscountChf,
      vatRatePct,
      vatAmountChf,
      grossPriceChf,
      automaticPvSubsidyChf,
      manualAdditionalSubsidyChf,
      subsidyChf,
      totalInvestmentChf,
      taxSavingsChf,
      effectiveCostChf,
    },
    options: {
      batteryLabel: batteryItem
        ? [
            safeString(batteryItem?.brand ?? batteryItem?.marke),
            safeString(batteryItem?.name ?? batteryItem?.beschreibung),
          ]
            .filter(Boolean)
            .join(" ")
        : "",
      wallboxLabel: wallboxItem
        ? [
            safeString(wallboxItem?.brand ?? wallboxItem?.marke),
            safeString(wallboxItem?.name ?? wallboxItem?.beschreibung),
          ]
            .filter(Boolean)
            .join(" ")
        : "",
      batteryPriceChf,
      wallboxPriceChf,
    },
    detailItems: enrichedItems.map((item: any, index: number) => ({
      position: index + 1,
      category: safeString(item?.category ?? item?.kategorie),
      brand: safeString(item?.brand ?? item?.marke),
      model: safeString(item?.model),
      name: safeString(item?.name ?? item?.label ?? item?.beschreibung),
      quantity: safeNumber(item?.quantity ?? item?.qty ?? item?.stk, 0),
      unit: safeString(item?.unit),
      unitLabel: safeString(item?.unitLabel),
      unitPriceNet: safeNumber(
        item?.unitPriceNet ??
          item?.unitPrice ??
          item?.einzelpreis ??
          item?.priceNet ??
          item?.priceChf,
        0,
      ),
      lineTotalNet: getItemLineTotal(item),
      catalogItemId: safeString(item?.catalogItemId),
      pdfSection: safeString(item?.pdfSection),
      description: safeString(item?.catalogDescription),
      longDescription: safeString(item?.catalogLongDescription),
      features: safeStringArray(item?.catalogFeatures),
      warranty: safeString(item?.catalogWarranty),
      compatibility: safeString(item?.catalogCompatibility),
      notes: safeString(item?.notes) || safeString(item?.catalogNotes),
    })),
  };

  const pdf = await PDFDocument.create();
  const snapshotEntry = await snapshotCache.findOne({
    planningId: String(planning?._id),
    companyId: planning?.companyId,
    expiresAt: { $gt: new Date() },
  });

  const projectSnapshotDataUrl = safeString(snapshotEntry?.snapshotDataUrl);
  const planner = data?.planner ?? {};
  const ist = data?.ist ?? {};
  const plannerSnapshot = planner?.snapshot ?? {};
  const selectedPanelId =
    safeString(planner?.selectedPanelId) || safeString(summary?.selectedPanelId);
  const selectedPanel = Array.isArray(planner?.catalogPanels)
    ? planner.catalogPanels.find((p: any) => safeString(p?.id) === selectedPanelId)
    : null;
  const selectedPanelLabel = selectedPanel
    ? [
        safeString(selectedPanel?.brand),
        safeString(selectedPanel?.model),
        selectedPanel?.wp ? `${safeNumber(selectedPanel.wp)} W` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : selectedPanelId || "—";

  const projectAddress =
    safeString(plannerSnapshot?.address) ||
    [
      safeString(profile?.street || profile?.buildingStreet),
      safeString(profile?.zip || profile?.buildingZip),
      safeString(profile?.city || profile?.buildingCity),
    ]
      .filter(Boolean)
      .join(", ");

  const inverterLabel =
    items
      .filter((item: any) => {
        const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
        return category === "wechselrichter" || category === "inverter";
      })
      .map((item: any) =>
        [
          safeString(item?.brand ?? item?.marke),
          safeString(item?.name ?? item?.beschreibung),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .filter(Boolean)
      .join(", ") || "—";

  const orderGeneratedAt = parseDate(args.orderGeneratedAt ?? planning?.orderGeneratedAt);
  const paymentRows = buildPaymentRows({
    planning,
    company,
    totalInklMwst: grossPriceChf,
    orderGeneratedAt,
  });

  await addCoverPage(pdf, {
    title: offer.title,
    planningNumber: offer.planningNumber,
    kWp: offer.pv.dcPowerKw,
    customerName: offer.customer.name,
    projectAddress,
    companyName: offer.companyName,
    customerSalutation,
    customerLastName,
    customerType,
    netSystemPriceChf: offer.pricing.netSystemPriceChf,
    discountChf: offer.pricing.discountChf,
    discountPct: offer.pricing.discountPct,
    discountFromPctChf: offer.pricing.discountFromPctChf,
    totalDiscountChf: offer.pricing.totalDiscountChf,
    vatRatePct: offer.pricing.vatRatePct,
    vatAmountChf: offer.pricing.vatAmountChf,
    grossPriceChf: offer.pricing.grossPriceChf,
    automaticPvSubsidyChf: offer.pricing.automaticPvSubsidyChf,
    manualAdditionalSubsidyChf: offer.pricing.manualAdditionalSubsidyChf,
    subsidyChf: offer.pricing.subsidyChf,
    totalInvestmentChf: offer.pricing.totalInvestmentChf,
    taxSavingsChf: offer.pricing.taxSavingsChf,
    effectiveCostChf: offer.pricing.effectiveCostChf,
    offerDate: todayFormatted,
    validUntil: validUntilFormatted,
    moduleCount: offer.pv.moduleCount,
    batteryLabel: offer.options.batteryLabel,
    wallboxLabel: offer.options.wallboxLabel,
    batteryPriceChf: offer.options.batteryPriceChf,
    wallboxPriceChf: offer.options.wallboxPriceChf,
    advisorName,
    advisorRole: "Beratung",
    documentType,
    documentTitle: identifiers.documentTitle,
    documentNumberLabel: identifiers.documentNumberLabel,
    orderGeneratedAt: orderGeneratedAt ? formatDateCH(orderGeneratedAt) : "",
    paymentRows,
    bankDetails: {
      accountHolder:
        safeString(company?.bank?.accountHolder) || safeString(company?.name) || "",
      iban: formatIban(company?.bank?.iban),
      bankName: safeString(company?.bank?.bankName),
      bicSwift: safeString(company?.bank?.bicSwift),
    },
  });

  const companyForPdf = company
    ? {
        name: safeString(company?.name),
        pdfSettings: {
          showFooter:
            typeof company?.pdfSettings?.showFooter === "boolean"
              ? company.pdfSettings.showFooter
              : true,
          footerCompanyName: safeString(company?.pdfSettings?.footerCompanyName),
          footerAddressLine: safeString(company?.pdfSettings?.footerAddressLine),
          footerEmail: safeString(company?.pdfSettings?.footerEmail),
          footerWebsite: safeString(company?.pdfSettings?.footerWebsite),
          footerPhone: safeString(company?.pdfSettings?.footerPhone),
          footerMobile: safeString(company?.pdfSettings?.footerMobile),
          footerBankName: safeString(company?.pdfSettings?.footerBankName),
          footerAccountHolder: safeString(company?.pdfSettings?.footerAccountHolder),
          footerIban: safeString(company?.pdfSettings?.footerIban),
          footerBic: safeString(company?.pdfSettings?.footerBic),
          footerVatNumber: safeString(company?.pdfSettings?.footerVatNumber),
          footerUidNumber: safeString(company?.pdfSettings?.footerUidNumber),
        },
      }
    : null;

  await addDetailPages(pdf, {
    offer,
    company: companyForPdf,
    documentType,
    documentTitle: identifiers.documentTitle,
    documentNumberLabel: identifiers.documentNumberLabel,
  });

  await addProjectOverviewPage(pdf, {
    title: offer.title,
    planningNumber: offer.planningNumber,
    projectSnapshotDataUrl,
    customerName: offer.customer.name,
    projectAddress,
    dcPowerKw: offer.pv.dcPowerKw,
    moduleCount: offer.pv.moduleCount,
    roofCount: safeNumber(summary?.roofCount, 0),
    selectedPanelLabel,
    inverterLabel,
    batteryLabel: offer.options.batteryLabel,
    wallboxLabel: offer.options.wallboxLabel,
    roofType: safeString(ist?.roofType || ist?.roofShape),
    roofCovering: safeString(ist?.roofCovering || ist?.roofCover),
    electricityUsageKwh: safeNumber(ist?.electricityUsageKwh || ist?.consumption, 0),
    companyName: offer.companyName,
    documentType,
    documentNumberLabel: identifiers.documentNumberLabel,
  });

  await addReportPages(pdf, {
    planningNumber: offer.planningNumber,
    companyName: offer.companyName,
    reportSummary,
    offer,
    documentType,
    documentNumberLabel: identifiers.documentNumberLabel,
  });

  const pdfBytes = await pdf.save();

  return {
    pdfBytes: Buffer.from(pdfBytes),
    fileName: `${identifiers.fileStem}.pdf`,
    pricing: {
      totalInklMwst: grossPriceChf,
      totalInvestmentChf,
      effectiveCostChf,
    },
    reportSummary,
  };
}

export { resolveDocumentType, roundToFiveCents, formatIban };
