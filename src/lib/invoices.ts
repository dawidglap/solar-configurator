import type { Db } from "mongodb";
import { ObjectId, ReturnDocument } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import { roundToFiveCents } from "@/lib/planningDocuments";
import {
  getSessionUserEmail,
  getSessionUserMeta,
  isAdminLikeRole,
  safeNumber,
} from "@/lib/tasks";
import { canGenerateOrders } from "@/lib/orders";

export const INVOICE_TYPES = ["rechnung", "mahnung", "gutschrift"] as const;
export const INVOICE_STATUSES = [
  "entwurf",
  "heruntergeladen",
  "versendet",
  "mahnung",
  "storniert",
] as const;
export const INVOICE_PAYMENT_STATUSES = ["offen", "teilweise", "bezahlt"] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

type InvoiceRateSpec = {
  rateIndex: number;
  pct: number;
  dueDate: Date;
};

type CreateOrderInvoicesArgs = {
  db: Db;
  companyId: string;
  planning: any;
  company: any;
  session: SessionPayload;
  orderId: string;
  orderGeneratedAt: Date;
  totalInklMwst: number;
};

function parseDate(value: unknown) {
  if (value instanceof Date) return value;
  const normalized = safeString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(0, Math.trunc(days)));
  return next;
}

function normalizeInvoiceType(value: unknown): InvoiceType | null {
  const normalized = safeString(value).toLowerCase() as InvoiceType;
  return INVOICE_TYPES.includes(normalized) ? normalized : null;
}

function normalizeInvoiceStatus(value: unknown): InvoiceStatus {
  const normalized = safeString(value).toLowerCase() as InvoiceStatus;
  return INVOICE_STATUSES.includes(normalized) ? normalized : "entwurf";
}

function normalizeInvoicePaymentStatus(value: unknown): InvoicePaymentStatus {
  const normalized = safeString(value).toLowerCase() as InvoicePaymentStatus;
  return INVOICE_PAYMENT_STATUSES.includes(normalized) ? normalized : "offen";
}

function extractRateSource(planning: any) {
  const data = planning?.data ?? {};
  return (
    data?.angebot?.n ??
    data?.angebot?.payments ??
    data?.offer?.payments ??
    data?.reportOptions?.payments ??
    []
  );
}

export function getInvoicesCollection(db: Db) {
  return db.collection("invoices");
}

export async function ensureInvoiceIndexes(db: Db) {
  const invoices = getInvoicesCollection(db);
  await Promise.all([
    invoices.createIndex({ companyId: 1, orderId: 1, rateIndex: 1, invoiceType: 1, createdAt: 1 }),
    invoices.createIndex({ companyId: 1, invoiceNumber: 1 }, { unique: true }),
    invoices.createIndex({ companyId: 1, planningId: 1, createdAt: -1 }),
    invoices.createIndex({ companyId: 1, dueDate: 1, paymentStatus: 1 }),
    invoices.createIndex({ companyId: 1, parentInvoiceId: 1 }),
  ]);
}

export function canWriteInvoices(session: SessionPayload | null | undefined) {
  return canGenerateOrders(session);
}

export function canManageInvoicePayments(session: SessionPayload | null | undefined) {
  return isAdminLikeRole(session);
}

function getCounterConfig(type: InvoiceType) {
  if (type === "mahnung") {
    return { counterType: "mahnung", prefix: "MA" };
  }
  if (type === "gutschrift") {
    return { counterType: "gutschrift", prefix: "GS" };
  }
  return { counterType: "rechnung", prefix: "RE" };
}

export async function nextInvoiceNumber(
  db: Db,
  companyId: string,
  type: InvoiceType,
  now = new Date(),
) {
  const year = now.getFullYear();
  const { counterType, prefix } = getCounterConfig(type);
  const counters = db.collection("counters");
  const result = await counters.findOneAndUpdate(
    {
      companyId,
      year,
      type: counterType,
    },
    {
      $inc: { seq: 1 },
      $setOnInsert: {
        companyId,
        year,
        type: counterType,
        createdAt: now,
      },
      $set: {
        updatedAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: ReturnDocument.AFTER,
    },
  );

  const seq = Number((result as any)?.seq ?? (result as any)?.value?.seq ?? 0);
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

export function buildInvoiceAnrede(planning: any) {
  const profile = planning?.data?.profile ?? {};
  const customerType = safeString(profile?.type ?? profile?.customerType).toLowerCase();
  const companyName = safeString(profile?.companyName);
  if (customerType === "company" || companyName) {
    return companyName ? `Firma ${companyName}` : "Firma";
  }
  return safeString(profile?.salutation ?? profile?.title ?? profile?.gender) || "Guten Tag";
}

export function getInvoiceRecipientDisplayName(planning: any) {
  const profile = planning?.data?.profile ?? {};
  return (
    safeString(profile?.companyName) ||
    [
      safeString(profile?.firstName ?? profile?.contactFirstName),
      safeString(profile?.lastName ?? profile?.contactLastName),
    ]
      .filter(Boolean)
      .join(" ") ||
    safeString(planning?.summary?.customerName) ||
    "Kundschaft"
  );
}

export function buildInvoiceDefaultBodyText(args: {
  planning: any;
  company: any;
  invoiceType: InvoiceType;
  rateIndex: number;
  pct: number;
  dueDate: Date;
  dunningLevel?: number;
}) {
  const template = safeString(args.company?.templates?.invoiceText);
  const recipientName = getInvoiceRecipientDisplayName(args.planning);
  const anrede = buildInvoiceAnrede(args.planning);
  const dueDateLabel = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(args.dueDate);

  if (template) {
    return template
      .replace(/\{\{anrede\}\}/gi, anrede)
      .replace(/\{\{customerName\}\}/gi, recipientName)
      .replace(/\{\{dueDate\}\}/gi, dueDateLabel)
      .replace(/\{\{rateIndex\}\}/gi, String(args.rateIndex + 1))
      .replace(/\{\{pct\}\}/gi, String(args.pct));
  }

  if (args.invoiceType === "mahnung") {
    return [
      `${anrede}`,
      "",
      `für die Rate ${args.rateIndex + 1} unserer Photovoltaik-Anlage ist der offene Betrag weiterhin ausstehend.`,
      `Bitte begleichen Sie die Forderung bis spätestens ${dueDateLabel}.`,
      args.dunningLevel ? `${args.dunningLevel}. Mahnung` : "Mahnung",
    ].join("\n");
  }

  if (args.invoiceType === "gutschrift") {
    return [
      `${anrede}`,
      "",
      "hiermit erhalten Sie die zugehörige Gutschrift zur bestehenden Rechnung.",
      `Die Abwicklung erfolgt mit Bezug auf die Rate ${args.rateIndex + 1}.`,
    ].join("\n");
  }

  return [
    `${anrede}`,
    "",
    "vielen Dank für Ihren Auftrag. Nachfolgend stellen wir Ihnen die vereinbarte Rate in Rechnung.",
    `Bitte begleichen Sie den Betrag bis zum ${dueDateLabel}.`,
  ].join("\n");
}

export function extractInvoiceRates(args: {
  planning: any;
  company: any;
  baseDate: Date;
}) {
  const rows = Array.isArray(extractRateSource(args.planning))
    ? extractRateSource(args.planning)
    : [];
  const specs = rows
    .map((row: any, index: number): InvoiceRateSpec | null => {
      const pct = safeNumber(
        row?.pct ?? row?.percent ?? row?.percentage ?? row?.sharePct,
        Number.NaN,
      );
      if (!Number.isFinite(pct) || pct <= 0) return null;

      const explicitDueDate = parseDate(row?.dueAt ?? row?.dueDate ?? row?.date);
      const dueOffsetDays = safeNumber(
        row?.dueOffsetDays ?? row?.dueInDays ?? row?.termDays ?? row?.days,
        safeNumber(args.company?.paymentDefaults?.termDays, 30),
      );
      return {
        rateIndex: index,
        pct,
        dueDate: explicitDueDate ?? addDays(args.baseDate, dueOffsetDays),
      };
    })
    .filter((row: InvoiceRateSpec | null): row is InvoiceRateSpec => !!row);

  if (specs.length > 0) return specs;

  return [
    {
      rateIndex: 0,
      pct: 100,
      dueDate: addDays(args.baseDate, safeNumber(args.company?.paymentDefaults?.termDays, 30)),
    },
  ];
}

export function normalizeInvoice(doc: any) {
  const issueDate = parseDate(doc?.issueDate);
  const dueDate = parseDate(doc?.dueDate);
  const paidAt = parseDate(doc?.paidAt);

  return {
    id: mongoIdToString(doc?._id),
    companyId: safeString(doc?.companyId),
    planningId: safeString(doc?.planningId),
    orderId: safeString(doc?.orderId),
    invoiceNumber: safeString(doc?.invoiceNumber),
    invoiceType: normalizeInvoiceType(doc?.invoiceType) ?? "rechnung",
    parentInvoiceId: mongoIdToString(doc?.parentInvoiceId) || null,
    rateIndex: safeNumber(doc?.rateIndex, 0),
    rateLabel: safeString(doc?.rateLabel),
    pct: safeNumber(doc?.pct, 0),
    amount: safeNumber(doc?.amount, 0),
    currency: safeString(doc?.currency) || "CHF",
    issueDate: issueDate ? issueDate.toISOString() : null,
    dueDate: dueDate ? dueDate.toISOString() : null,
    status: normalizeInvoiceStatus(doc?.status),
    paymentStatus: normalizeInvoicePaymentStatus(doc?.paymentStatus),
    paidAt: paidAt ? paidAt.toISOString() : null,
    paidAmount: safeNumber(doc?.paidAmount, 0),
    anrede: safeString(doc?.anrede),
    bodyText: safeString(doc?.bodyText),
    internalNote: safeString(doc?.internalNote),
    pdfFileId: mongoIdToString(doc?.pdfFileId) || null,
    createdByUserId: mongoIdToString(doc?.createdByUserId) || safeString(doc?.createdByUserId) || null,
    createdByName: safeString(doc?.createdByName) || null,
    createdByEmail: safeString(doc?.createdByEmail) || null,
    createdAt: parseDate(doc?.createdAt)?.toISOString() ?? null,
    updatedAt: parseDate(doc?.updatedAt)?.toISOString() ?? null,
    dunningEligible: Boolean(doc?.dunningEligible),
    dunningLevel: safeNumber(doc?.dunningLevel, 0),
  };
}

export async function createInvoicesForOrderIfMissing(args: CreateOrderInvoicesArgs) {
  await ensureInvoiceIndexes(args.db);
  const invoices = getInvoicesCollection(args.db);
  const existing = await invoices
    .find({
      companyId: args.companyId,
      orderId: args.orderId,
      invoiceType: "rechnung",
    })
    .sort({ rateIndex: 1, createdAt: 1, _id: 1 })
    .toArray();

  if (existing.length > 0) {
    return {
      created: false,
      invoices: existing,
    };
  }

  const createdAt = new Date();
  const userMeta = getSessionUserMeta(args.session);
  const createdByUserId = toObjectIdOrNull(userMeta.id) ?? userMeta.id ?? null;
  const createdByEmail = getSessionUserEmail(args.session) || null;
  const issueDate =
    args.orderGeneratedAt instanceof Date && !Number.isNaN(args.orderGeneratedAt.getTime())
      ? args.orderGeneratedAt
      : createdAt;
  const rates = extractInvoiceRates({
    planning: args.planning,
    company: args.company,
    baseDate: issueDate,
  });

  const docs = [];
  for (const rate of rates) {
    const invoiceNumber = await nextInvoiceNumber(args.db, args.companyId, "rechnung", createdAt);
    const amount = roundToFiveCents((args.totalInklMwst * rate.pct) / 100);
    docs.push({
      companyId: args.companyId,
      planningId: safeString(args.planning?._id?.toString?.() ?? args.planning?._id),
      orderId: args.orderId,
      invoiceNumber,
      invoiceType: "rechnung",
      parentInvoiceId: null,
      rateIndex: rate.rateIndex,
      rateLabel: `${invoiceNumber}-${rate.rateIndex + 1}`,
      pct: rate.pct,
      amount,
      currency: safeString(args.company?.paymentDefaults?.currency) || "CHF",
      issueDate,
      dueDate: rate.dueDate,
      status: "entwurf",
      paymentStatus: "offen",
      paidAt: null,
      paidAmount: 0,
      anrede: buildInvoiceAnrede(args.planning),
      bodyText: buildInvoiceDefaultBodyText({
        planning: args.planning,
        company: args.company,
        invoiceType: "rechnung",
        rateIndex: rate.rateIndex,
        pct: rate.pct,
        dueDate: rate.dueDate,
      }),
      internalNote: "",
      pdfFileId: null,
      createdAt,
      updatedAt: createdAt,
      createdByUserId,
      createdByName: userMeta.name || "Unbekannt",
      createdByEmail,
      dunningEligible: false,
      dunningLevel: 0,
    });
  }

  if (docs.length === 0) {
    return { created: false, invoices: [] };
  }

  await invoices.insertMany(docs);
  const inserted = await invoices
    .find({
      companyId: args.companyId,
      orderId: args.orderId,
      invoiceType: "rechnung",
    })
    .sort({ rateIndex: 1, createdAt: 1, _id: 1 })
    .toArray();

  return {
    created: true,
    invoices: inserted,
  };
}

export async function getInvoiceByIdForCompany(db: Db, invoiceId: string, companyId: string) {
  const objectId = toObjectIdOrNull(invoiceId);
  if (!objectId) return null;
  return getInvoicesCollection(db).findOne({
    _id: objectId,
    companyId,
  });
}

export function computeInvoicePaymentStatus(amount: number, paidAmount: number) {
  const openThreshold = Math.abs(amount) - Math.abs(paidAmount);
  if (openThreshold <= 0.009) return "bezahlt" as InvoicePaymentStatus;
  if (Math.abs(paidAmount) > 0.009) return "teilweise" as InvoicePaymentStatus;
  return "offen" as InvoicePaymentStatus;
}

