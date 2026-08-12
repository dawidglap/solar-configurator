import { ObjectId, type Db } from "mongodb";
import { PDFDocument } from "pdf-lib";
import { addCoverPage } from "@/app/api/plannings/[planningId]/offer/pdf/cover-page";
import { buildReportSummary } from "@/app/api/plannings/[planningId]/report-summary/route";
import { safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { getSessionUserMeta } from "@/lib/tasks";
import {
  downloadCompanyDocumentBuffer,
  type CompanyDocumentKind,
} from "@/lib/companyDocuments";
import { renderAnalyse } from "@/lib/pdf/sections/analyse";
import { renderProjektuebersicht } from "@/lib/pdf/sections/projektuebersicht";
import { renderTechnischeEckdaten } from "@/lib/pdf/sections/technischeEckdaten";
import { htmlToPlainText } from "@/lib/htmlToPlainText";
import { allocateChf05, roundChf05, sumChf05 } from "@/lib/chf";

export type PlanningDocumentType = "angebot" | "auftrag";
export type PlanningReportSections = {
  projektuebersicht: boolean;
  technischeEckdaten: boolean;
  analyse: boolean;
};

type PaymentRow = {
  label: string;
  pct: number;
  amountChf: number;
  dueAt: string;
  dueDate: Date;
};

type ResolvedBankDetails = {
  accountHolder: string;
  iban: string;
  bankName: string;
  bicSwift: string;
};

export type OptionalCommercialItem = {
  label: string;
  name: string;
  note: string;
  description: string;
  qty: number;
  unit: string;
  priceChf: number;
};

type BuildPlanningDocumentPdfArgs = {
  db: Db;
  planning: any;
  company: any;
  session: SessionPayload;
  documentType: PlanningDocumentType;
  orderId?: string | null;
  orderGeneratedAt?: Date | string | null;
  sections?: PlanningReportSections;
};

function pickBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

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

function formatIban(value: unknown) {
  const compact = safeString(value).replace(/\s+/g, "").toUpperCase();
  if (!compact) return "";
  return compact.replace(/(.{4})(?=.)/g, "$1 ").trim();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(0, Math.trunc(days)));
  return next;
}

function splitFeatureLines(value: unknown) {
  return htmlToPlainText(value)
    .split(/\r?\n/)
    .map((line) => safeString(line))
    .filter(Boolean);
}

function getCompanyFooterCandidates(company: any) {
  const pdfSettings = company?.pdfSettings ?? {};
  return [
    safeString(pdfSettings?.footerBankName),
    safeString(pdfSettings?.footerAccountHolder),
    safeString(pdfSettings?.footerIban),
    safeString(pdfSettings?.footerBic),
  ].filter(Boolean);
}

function parseFooterBankDetails(company: any) {
  const segments = getCompanyFooterCandidates(company)
    .flatMap((value) =>
      value
        .split(/[·•|]/)
        .map((segment) => safeString(segment))
        .filter(Boolean),
    );

  let bankName = "";
  let accountHolder = "";
  let iban = "";
  let bicSwift = "";

  for (const segment of segments) {
    const compact = segment.replace(/\s+/g, "").toUpperCase();
    if (!iban && /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(compact)) {
      iban = compact;
      continue;
    }

    if (!bicSwift && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact)) {
      bicSwift = compact;
      continue;
    }

    if (!bankName) {
      bankName = segment;
      continue;
    }

    if (!accountHolder) {
      accountHolder = segment;
    }
  }

  return {
    bankName,
    accountHolder,
    iban,
    bicSwift,
  };
}

function resolveBankDetails(company: any): ResolvedBankDetails {
  const bank = company?.bank ?? {};
  const billing = company?.billing ?? {};
  const footerParsed = parseFooterBankDetails(company);

  return {
    accountHolder:
      safeString(bank?.accountHolder) ||
      safeString(company?.name) ||
      safeString(billing?.accountHolder) ||
      safeString(footerParsed.accountHolder),
    iban:
      safeString(bank?.iban) ||
      safeString(billing?.iban) ||
      safeString(footerParsed.iban),
    bankName:
      safeString(bank?.bankName) ||
      safeString(billing?.bankName) ||
      safeString(footerParsed.bankName),
    bicSwift:
      safeString(bank?.bicSwift) ||
      safeString(billing?.bicSwift ?? billing?.bic) ||
      safeString(footerParsed.bicSwift),
  };
}

function buildCompanyAddressLines(company: any) {
  const street = safeString(company?.address?.street);
  const place = [safeString(company?.address?.zip), safeString(company?.address?.city)]
    .filter(Boolean)
    .join(" ");
  const country = safeString(company?.address?.country);

  return [
    safeString(company?.name),
    street,
    place,
    country && country.toLowerCase() !== "schweiz" ? country : "",
  ].filter(Boolean);
}

function buildCustomerAddressLines(profile: any, summary: any) {
  const salutation = safeString(profile?.salutation ?? profile?.title ?? profile?.gender);
  const name =
    [safeString(profile?.firstName ?? profile?.contactFirstName), safeString(profile?.lastName ?? profile?.contactLastName)]
      .filter(Boolean)
      .join(" ") ||
    safeString(profile?.companyName) ||
    safeString(summary?.customerName);
  const street = safeString(profile?.street ?? profile?.buildingStreet);
  const place = [
    safeString(profile?.zip ?? profile?.buildingZip),
    safeString(profile?.city ?? profile?.buildingCity),
  ]
    .filter(Boolean)
    .join(" ");

  return [salutation, name, street, place].filter(Boolean);
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

function isOptionalItem(item: any) {
  return item?.optional === true;
}

function buildOptionalCommercialItem(item: any): OptionalCommercialItem {
  const itemName = safeString(item?.name ?? item?.beschreibung);
  const brand = safeString(item?.brand ?? item?.marke);
  const identity = safeString(item?.model) || itemName;
  const productName =
    brand && identity && !identity.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${identity}`
      : identity || brand;

  const description = htmlToPlainText(
    item?.description ?? item?.longDescription,
  );
  const note = htmlToPlainText(item?.note ?? item?.notes) || description;

  return {
    label:
      safeString(item?.label) ||
      itemName ||
      safeString(item?.category ?? item?.kategorie) ||
      "Optionale Position",
    name: productName || itemName,
    note,
    description,
    qty: safeNumber(item?.quantity ?? item?.qty ?? item?.stk, 0),
    unit: safeString(item?.unitLabel ?? item?.unit ?? item?.einheit) || "Stk.",
    priceChf: roundChf05(getItemLineTotal(item)),
  };
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
    documentNumberLabel: `Angebot Nr. ${planningNumber}`,
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

function getEnabledCompanyDocumentKinds(planning: any): CompanyDocumentKind[] {
  const formDocuments = planning?.data?.parts?.formDocuments ?? {};
  const orderedKinds: CompanyDocumentKind[] = ["vollmacht", "bestellformular", "agb"];
  return orderedKinds.filter((kind) => formDocuments?.[kind] === true);
}

async function appendCompanyOwnedOfferAttachments(args: {
  db: Db;
  pdf: PDFDocument;
  planning: any;
  companyId: string;
}) {
  const enabledKinds = getEnabledCompanyDocumentKinds(args.planning);
  if (!enabledKinds.length) return;

  for (const kind of enabledKinds) {
    const payload = await downloadCompanyDocumentBuffer(args.db, args.companyId, kind);
    if (!payload?.buffer) {
      console.warn(`[offer-pdf] company document missing, skip append`, {
        companyId: args.companyId,
        kind,
        planningId: safeString(args.planning?._id),
      });
      continue;
    }

    try {
      const attachmentPdf = await PDFDocument.load(payload.buffer);
      const pageIndexes = attachmentPdf.getPageIndices();
      const copiedPages = await args.pdf.copyPages(attachmentPdf, pageIndexes);
      for (const page of copiedPages) {
        args.pdf.addPage(page);
      }
    } catch (error: any) {
      console.warn(`[offer-pdf] company document append failed`, {
        companyId: args.companyId,
        kind,
        planningId: safeString(args.planning?._id),
        message: error?.message,
      });
    }
  }
}

function buildPaymentRows(args: {
  planning: any;
  totalInklMwst: number;
  baseDate: Date;
}) {
  const data = args.planning?.data ?? {};
  const rows = Array.isArray(extractPaymentsSource(data))
    ? extractPaymentsSource(data)
    : [];

  const validRows: Array<{ row: any; index: number; pct: number }> = rows
    .map((row: any, index: number) => ({
      row,
      index,
      pct: safeNumber(
        row?.pct ?? row?.percent ?? row?.percentage ?? row?.sharePct,
        Number.NaN,
      ),
    }))
    .filter(({ pct }: { pct: number }) => Number.isFinite(pct) && pct > 0);
  const allocatedAmounts = allocateChf05(
    args.totalInklMwst,
    validRows.map(({ pct }: { pct: number }) => pct),
  );

  return validRows.map(({ row, index, pct }, paymentIndex): PaymentRow => {
      const amountChf = allocatedAmounts[paymentIndex];
      const label =
        safeString(row?.label) ||
        safeString(row?.name) ||
        `Rate ${index + 1}`;

      const explicitDueDate = parseDate(row?.dueAt ?? row?.dueDate ?? row?.date);
      const dueOffsetDays = safeNumber(
        row?.dueOffsetDays ?? row?.dueInDays ?? row?.termDays ?? row?.days,
        0,
      );
      const computedDueDate = addDays(args.baseDate, dueOffsetDays);
      const dueDate = explicitDueDate ?? computedDueDate;

      return {
        label,
        pct,
        amountChf,
        dueAt: formatDateCH(dueDate),
        dueDate,
      };
    });
}

export function resolveReportSections(planning: any): PlanningReportSections {
  const rawSections = planning?.data?.parts?.reportSections ?? {};
  return {
    projektuebersicht: rawSections?.projektuebersicht ?? true,
    technischeEckdaten: rawSections?.technischeEckdaten ?? true,
    analyse: rawSections?.analyse ?? rawSections?.bericht ?? true,
  };
}

export async function computePlanningCommercialSummary(db: Db, planning: any) {
  const data = planning?.data ?? {};
  const parts = data?.parts ?? {};
  const reportOptions = data?.reportOptions ?? {};
  const summary = planning?.summary ?? {};
  const items = Array.isArray(parts?.items) ? parts.items : [];
  const includedItems = items.filter((item: any) => !isOptionalItem(item));
  const optionalSourceItems = items.filter(isOptionalItem);
  const optionalItems: OptionalCommercialItem[] = optionalSourceItems.map(
    buildOptionalCommercialItem,
  );
  const optionalTotalChf = sumChf05(
    optionalSourceItems.map((item: any) => getItemLineTotal(item)),
  );

  const catalogDocs = await db
    .collection("catalogItems")
    .find({
      companyId: planning?.companyId,
      isActive: true,
    })
    .toArray();

  const reportSummary = buildReportSummary(planning, catalogDocs);
  const mwstIncluded =
    pickBoolean(
      planning?.data?.reportOptions?.mwstIncluded,
      reportSummary?.mwstIncluded,
    ) ?? true;

  const partsTotalNet = sumChf05(
    includedItems.map((item: any) => getItemLineTotal(item)),
  );

  const discountChf = roundChf05(safeNumber(
    reportSummary?.discountChf ?? reportOptions?.discountChf,
    0,
  ));
  const discountPct = safeNumber(
    reportSummary?.discountPct ?? reportOptions?.discountPct,
    0,
  );
  const discountFromPctChf = roundChf05(
    reportSummary?.discountFromPctChf ??
      (partsTotalNet * discountPct) / 100,
  );
  const totalDiscountChf = roundChf05(
    reportSummary?.totalDiscountChf ??
      (discountChf + discountFromPctChf),
  );
  const netAfterDiscountChf = roundChf05(
    Math.max(0, partsTotalNet - totalDiscountChf),
  );
  const vatRatePct = 8.1;
  const vatAmountChf = mwstIncluded
    ? roundChf05(netAfterDiscountChf * (vatRatePct / 100))
    : 0;
  const grossPriceChf = mwstIncluded
    ? roundChf05(netAfterDiscountChf + vatAmountChf)
    : netAfterDiscountChf;

  const dcPowerKw = safeNumber(summary?.dcPowerKw, 0);
  const automaticPvSubsidyChf = roundChf05(safeNumber(
    reportSummary?.automaticPvSubsidyChf,
    dcPowerKw <= 0 ? 0 : dcPowerKw <= 30 ? dcPowerKw * 360 : dcPowerKw * 300,
  ));
  const manualAdditionalSubsidyChf = roundChf05(safeNumber(
    reportSummary?.manualAdditionalSubsidyChf ?? reportOptions?.additionalSubsidyChf,
    0,
  ));
  const subsidyChf = roundChf05(
    automaticPvSubsidyChf + manualAdditionalSubsidyChf,
  );
  const totalInvestmentChf = roundChf05(
    Math.max(0, grossPriceChf - subsidyChf),
  );
  const taxSavingsChf = roundChf05(safeNumber((reportSummary as any)?.taxSavingsChf, 0));
  const effectiveCostChf = roundChf05(
    Math.max(0, totalInvestmentChf - taxSavingsChf),
  );

  return {
    catalogDocs,
    reportSummary,
    partsTotalNet,
    optionalTotalChf,
    optionalItems,
    discountChf,
    discountPct,
    discountFromPctChf,
    totalDiscountChf,
    netAfterDiscountChf,
    vatRatePct,
    vatAmountChf,
    grossPriceChf,
    mwstIncluded,
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
  const sections = args.sections ?? resolveReportSections(planning);

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
  const reportOptions = data?.reportOptions ?? {};
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
    mwstIncluded,
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
    if (isOptionalItem(item)) return false;
    const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
    return category === "batterie" || category === "battery" || category === "speicher";
  });
  const wallboxItems = items.filter((item: any) => {
    if (isOptionalItem(item)) return false;
    const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
    return category === "ladestation" || category === "wallbox";
  });

  const batteryItem = batteryItems[0];
  const wallboxItem = wallboxItems[0];
  const batteryPriceChf = sumChf05(
    batteryItems.map((item: any) => getItemLineTotal(item)),
  );
  const wallboxPriceChf = sumChf05(
    wallboxItems.map((item: any) => getItemLineTotal(item)),
  );
  const baseSystemNetChf = roundChf05(
    Math.max(0, partsTotalNet - batteryPriceChf - wallboxPriceChf),
  );

  const identifiers = getDocumentIdentifiers({
    planning,
    documentType,
    orderId: args.orderId,
  });
  const orderGeneratedAt = parseDate(args.orderGeneratedAt ?? planning?.orderGeneratedAt);
  const invoiceDate =
    documentType === "auftrag" ? orderGeneratedAt ?? today : today;

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
      mwstIncluded,
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
    detailItems: enrichedItems.map((item: any, index: number) => {
      const rowLongDescription = htmlToPlainText(item?.longDescription);
      const catalogLongDescription = htmlToPlainText(item?.catalogLongDescription);
      const explicitFeatures = safeStringArray(item?.features)
        .map(htmlToPlainText)
        .filter(Boolean);
      const fallbackFeatures =
        explicitFeatures.length > 0
          ? explicitFeatures
          : splitFeatureLines(rowLongDescription);
      const finalLongDescription =
        explicitFeatures.length === 0 && fallbackFeatures.length > 0
          ? ""
          : rowLongDescription || catalogLongDescription;

      return {
        position: index + 1,
        category: safeString(item?.category ?? item?.kategorie),
        brand: safeString(item?.brand ?? item?.marke),
        model: safeString(item?.model),
        name: safeString(item?.name ?? item?.label ?? item?.beschreibung),
        quantity: safeNumber(item?.quantity ?? item?.qty ?? item?.stk, 0),
        unit: safeString(item?.unit),
        unitLabel: safeString(item?.unitLabel),
        unitPriceNet: roundChf05(safeNumber(
          item?.unitPriceNet ??
            item?.unitPrice ??
            item?.einzelpreis ??
            item?.priceNet ??
            item?.priceChf,
          0,
        )),
        lineTotalNet: roundChf05(getItemLineTotal(item)),
        catalogItemId: safeString(item?.catalogItemId),
        pdfSection: safeString(item?.pdfSection),
        description: htmlToPlainText(item?.catalogDescription),
        longDescription: finalLongDescription,
        features:
          fallbackFeatures.length > 0
            ? fallbackFeatures
            : safeStringArray(item?.catalogFeatures)
                .map(htmlToPlainText)
                .filter(Boolean),
        warranty: safeString(item?.catalogWarranty),
        compatibility: safeString(item?.catalogCompatibility),
        notes:
          htmlToPlainText(item?.notes) ||
          htmlToPlainText(item?.catalogNotes),
        optional: isOptionalItem(item),
      };
    }),
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${identifiers.documentTitle} ${identifiers.documentNumber}`);
  pdf.setSubject(
    documentType === "angebot"
      ? "Angebot für eine Photovoltaikanlage"
      : "Auftrag für eine Photovoltaikanlage",
  );
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
    mwstIncluded: offer.pricing.mwstIncluded,
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
    paymentTerms:
      safeString(reportSummary?.paymentTerms) ||
      safeString(reportOptions?.paymentTerms ?? reportOptions?.zahlungsbedingungen) ||
      "Nach Absprache",
    skontoPct: safeNumber(reportSummary?.skontoPct ?? reportOptions?.skontoPct, 0),
    skontoDays: safeNumber(reportOptions?.skontoDays, 10),
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

  if (sections.technischeEckdaten) {
    await renderTechnischeEckdaten(pdf, {
      offer,
      company: companyForPdf,
      documentType,
      documentTitle: identifiers.documentTitle,
      documentNumberLabel: identifiers.documentNumberLabel,
    });
  }

  if (sections.projektuebersicht) {
    await renderProjektuebersicht(pdf, {
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
  }

  if (sections.analyse) {
    await renderAnalyse(pdf, {
      planningNumber: offer.planningNumber,
      companyName: offer.companyName,
      reportSummary,
      offer,
      documentType,
      documentNumberLabel: identifiers.documentNumberLabel,
      orderGeneratedAt:
        documentType === "auftrag" && orderGeneratedAt
          ? formatDateCH(orderGeneratedAt)
          : "",
    });
  }

  if (documentType === "angebot") {
    await appendCompanyOwnedOfferAttachments({
      db,
      pdf,
      planning,
      companyId: String(planning?.companyId || session?.activeCompanyId || ""),
    });
  }

  const pdfBytes = await pdf.save();

  return {
    pdfBytes: Buffer.from(pdfBytes),
    fileName: `${identifiers.fileStem}.pdf`,
    pricing: {
      totalInklMwst: totalInvestmentChf,
      totalInvestmentChf,
      effectiveCostChf,
    },
    reportSummary,
  };
}

export { resolveDocumentType, roundChf05 as roundToFiveCents, formatIban };
