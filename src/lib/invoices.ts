import type { Db } from "mongodb";
import { ObjectId, ReturnDocument } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
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
export const VALID_PAYMENT_TERMS = [
  "100 %",
  "50 % / 50 %",
  "50 % / 40 % / 10 %",
  "Nach Absprache",
] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];
export type PaymentTerms = (typeof VALID_PAYMENT_TERMS)[number];

type InvoiceRateSpec = {
  rateIndex: number;
  label: string;
  pct: number;
  dueDate: Date | null;
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

function parseIsoDateOnly(value: unknown) {
  const normalized = safeString(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "invalid";
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "invalid";
  return date;
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
    data?.angebot?.payments ??
    data?.angebot?.n ??
    data?.offer?.payments ??
    data?.reportOptions?.payments ??
    []
  );
}

export function normalizePlanningPaymentTerms(planning: any): PaymentTerms | null {
  const value = safeString(
    planning?.data?.reportOptions?.paymentTerms ??
      planning?.data?.reportOptions?.zahlungsbedingungen,
  );
  return VALID_PAYMENT_TERMS.includes(value as PaymentTerms) ? (value as PaymentTerms) : null;
}

export function derivePaymentsFromPaymentTerms(paymentTerms: PaymentTerms): InvoiceRateSpec[] {
  if (paymentTerms === "50 % / 50 %") {
    return [
      { rateIndex: 0, label: "Anzahlung", pct: 50, dueDate: null },
      { rateIndex: 1, label: "Schlussrechnung", pct: 50, dueDate: null },
    ];
  }

  if (paymentTerms === "50 % / 40 % / 10 %") {
    return [
      { rateIndex: 0, label: "Anzahlung", pct: 50, dueDate: null },
      { rateIndex: 1, label: "Zwischenrate", pct: 40, dueDate: null },
      { rateIndex: 2, label: "Schlussrechnung", pct: 10, dueDate: null },
    ];
  }

  return [
    { rateIndex: 0, label: "Schlussrechnung", pct: 100, dueDate: null },
  ];
}

export function getPlannedInvoiceRates(planning: any) {
  const rawRows = extractRateSource(planning);
  const validation = validatePlanningPayments(rawRows);
  if (!validation.ok) {
    return validation;
  }

  if (validation.items.length > 0) {
    return {
      ok: true as const,
      items: validation.items.map((row) => ({
        rateIndex: row.rateIndex,
        label: row.label,
        pct: row.pct,
        dueDate: row.dueDate ?? null,
      })),
      paymentTerms: normalizePlanningPaymentTerms(planning),
    };
  }

  const paymentTerms = normalizePlanningPaymentTerms(planning);
  if (!paymentTerms) {
    return {
      ok: true as const,
      items: [] as InvoiceRateSpec[],
      paymentTerms: null,
    };
  }

  return {
    ok: true as const,
    items: derivePaymentsFromPaymentTerms(paymentTerms),
    paymentTerms,
  };
}

export function validatePlanningPayments(rawPayments: unknown) {
  if (rawPayments == null) {
    return { ok: true as const, items: [] as InvoiceRateSpec[] };
  }

  if (!Array.isArray(rawPayments)) {
    return { ok: false as const, message: "Zahlungsraten sind ungültig." };
  }

  if (rawPayments.length > 5) {
    return { ok: false as const, message: "Maximal 5 Zahlungsraten sind erlaubt." };
  }

  let totalPct = 0;
  const items: InvoiceRateSpec[] = [];
  for (let index = 0; index < rawPayments.length; index += 1) {
    const row = rawPayments[index] as any;
    const pct = safeNumber(
      row?.pct ?? row?.percent ?? row?.percentage ?? row?.sharePct,
      Number.NaN,
    );

    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false as const, message: "Zahlungsrate Prozentwert ist ungültig." };
    }

    totalPct += pct;

    const parsedDueDate = parseIsoDateOnly(row?.dueDate ?? row?.dueAt ?? row?.date);
    if (parsedDueDate === "invalid") {
      return { ok: false as const, message: "Fälligkeitsdatum ist ungültig." };
    }

    items.push({
      rateIndex: index,
      label: safeString(row?.label) || `Rate ${index + 1}`,
      pct,
      dueDate: parsedDueDate,
    });
  }

  if (totalPct > 100.01) {
    return { ok: false as const, message: "Die Summe der Zahlungsraten darf 100.01% nicht überschreiten." };
  }

  return { ok: true as const, items };
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
    invoices.createIndex({ companyId: 1, invoiceType: 1, createdAt: -1, _id: -1 }),
    invoices.createIndex({ companyId: 1, paymentStatus: 1, dueDate: 1, createdAt: -1, _id: -1 }),
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
    position: safeNumber(doc?.position, safeNumber(doc?.rateIndex, 0)),
    rateLabel: safeString(doc?.rateLabel),
    label: safeString(doc?.label) || safeString(doc?.rateLabel) || safeString(doc?.invoiceNumber),
    pct: safeNumber(doc?.pct, 0),
    percentage: safeNumber(doc?.percentage, safeNumber(doc?.pct, 0)),
    amount: safeNumber(doc?.amount, 0),
    amountChf: safeNumber(doc?.amountChf, safeNumber(doc?.amount, 0)),
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
  const totalAmount = Number(safeNumber(args.totalInklMwst, 0).toFixed(2));
  let allocated = 0;
  for (let index = 0; index < rates.length; index += 1) {
    const rate = rates[index];
    const invoiceNumber = `${args.orderId}-R${rate.rateIndex + 1}`;
    const isLast = index === rates.length - 1;
    const amount = isLast
      ? Number((totalAmount - allocated).toFixed(2))
      : Number(((safeNumber(args.totalInklMwst, 0) * rate.pct) / 100).toFixed(2));
    allocated = Number((allocated + amount).toFixed(2));
    const persistedDueDate = rate.dueDate ?? null;
    const effectiveDueDateForText =
      persistedDueDate ?? addDays(issueDate, safeNumber(args.company?.paymentDefaults?.termDays, 30));
    docs.push({
      companyId: args.companyId,
      planningId: safeString(args.planning?._id?.toString?.() ?? args.planning?._id),
      orderId: args.orderId,
      invoiceNumber,
      invoiceType: "rechnung",
      parentInvoiceId: null,
      rateIndex: rate.rateIndex,
      position: rate.rateIndex,
      label: rate.label,
      rateLabel: rate.label,
      pct: rate.pct,
      percentage: rate.pct,
      amount,
      amountChf: amount,
      currency: safeString(args.company?.paymentDefaults?.currency) || "CHF",
      issueDate,
      dueDate: persistedDueDate,
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
        dueDate: effectiveDueDateForText,
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

export function extractInvoiceRates(args: {
  planning: any;
  company: any;
  baseDate: Date;
}) {
  const resolved = getPlannedInvoiceRates(args.planning);
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }

  if (resolved.items.length > 0) {
    return resolved.items;
  }

  return [{ rateIndex: 0, label: "Schlussrechnung", pct: 100, dueDate: null }];
}

export async function resyncOrderInvoices(args: {
  db: Db;
  companyId: string;
  planning: any;
  company: any;
  session: SessionPayload;
  orderId: string;
  orderGeneratedAt: Date;
  totalInklMwst: number;
}) {
  await ensureInvoiceIndexes(args.db);
  const invoices = getInvoicesCollection(args.db);
  const existing = await invoices
    .find({
      companyId: args.companyId,
      orderId: args.orderId,
    })
    .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
    .toArray();

  if (existing.some((invoice) => normalizeInvoicePaymentStatus(invoice?.paymentStatus) === "bezahlt")) {
    return {
      ok: false as const,
      status: 409,
      message: "Rechnungen sind bereits bezahlt — Synchronisation nicht möglich.",
    };
  }

  if (existing.length > 0) {
    await invoices.deleteMany({
      companyId: args.companyId,
      orderId: args.orderId,
      invoiceType: "rechnung",
      paymentStatus: { $ne: "bezahlt" },
    });
  }

  const created = await createInvoicesForOrderIfMissing(args);
  return {
    ok: true as const,
    status: 200,
    invoices: created.invoices,
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
