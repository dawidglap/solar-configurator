import type { Db } from "mongodb";
import { safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { roundChf05, sumChf05 } from "@/lib/chf";
import {
  buildInvoiceAnrede,
  buildInvoiceDefaultBodyText,
  ensureInvoiceIndexes,
  getInvoicesCollection,
  nextInvoiceNumber,
} from "@/lib/invoices";
import { getSessionUserEmail, getSessionUserMeta, safeNumber } from "@/lib/tasks";

export class HeatingInvoiceContractError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "HeatingInvoiceContractError";
    this.status = status;
  }
}

function parseDueDate(value: unknown) {
  if (value == null || value === "") return null;
  const text = safeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HeatingInvoiceContractError("Fälligkeitsdatum im Heizungsauftrag ist ungültig.");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HeatingInvoiceContractError("Fälligkeitsdatum im Heizungsauftrag ist ungültig.");
  }
  return date;
}

export function getHeatingInvoicePlan(auftrag: any) {
  if (safeString(auftrag?.projectType) !== "heating") {
    throw new HeatingInvoiceContractError("Ein kanonischer Heizungsauftrag ist erforderlich.", 400);
  }
  const snapshot = auftrag?.heatingOrderSnapshot;
  if (!snapshot || safeString(snapshot?.projectType) !== "heating") {
    throw new HeatingInvoiceContractError("Der Heizungsauftrag enthält keinen gültigen Vertragssnapshot.");
  }

  const rawTotalGross = safeNumber(snapshot?.pricing?.totalGross, Number.NaN);
  const totalGross = roundChf05(rawTotalGross);
  if (!Number.isFinite(totalGross) || totalGross <= 0 || Math.abs(rawTotalGross - totalGross) > 0.009) {
    throw new HeatingInvoiceContractError("Vertragssumme im Heizungsauftrag ist ungültig.");
  }
  if (!Array.isArray(snapshot?.payments) || snapshot.payments.length === 0 || snapshot.payments.length > 5) {
    throw new HeatingInvoiceContractError("Zahlungsplan im Heizungsauftrag ist ungültig.");
  }

  let totalPct = 0;
  const items = snapshot.payments.map((payment: any, rateIndex: number) => {
    const label = safeString(payment?.label);
    const pct = safeNumber(payment?.pct, Number.NaN);
    const rawAmount = safeNumber(payment?.amount, Number.NaN);
    const amount = roundChf05(rawAmount);
    if (!label || !Number.isFinite(pct) || pct < 0 || pct > 100 || !Number.isFinite(amount) || amount <= 0 || Math.abs(rawAmount - amount) > 0.009) {
      throw new HeatingInvoiceContractError("Zahlungsrate im Heizungsauftrag ist ungültig.");
    }
    totalPct += pct;
    return {
      rateIndex,
      label,
      pct,
      amount,
      dueDate: parseDueDate(payment?.dueDate),
      dueDateContract: payment?.dueDate == null ? null : safeString(payment.dueDate),
    };
  });

  if (Math.abs(totalPct - 100) > 0.01) {
    throw new HeatingInvoiceContractError("Zahlungsprozente im Heizungsauftrag ergeben nicht 100%.");
  }
  if (Math.abs(sumChf05(items.map((item: any) => item.amount)) - totalGross) > 0.009) {
    throw new HeatingInvoiceContractError("Zahlungsraten entsprechen nicht der Vertragssumme.");
  }

  return {
    projectType: "heating" as const,
    paymentTerms: safeString(snapshot?.paymentTerms),
    totalGross,
    currency: safeString(auftrag?.currency) || "CHF",
    items,
  };
}

export function buildHeatingInvoicePlanning(auftrag: any) {
  const snapshot = auftrag?.heatingOrderSnapshot;
  const customer = snapshot?.customer ?? {};
  const address = customer?.address ?? {};
  const isCompany = safeString(customer?.type) === "company";
  return {
    _id: auftrag?.planningId,
    companyId: auftrag?.companyId,
    customerId: auftrag?.customerId,
    projectType: "heating",
    orderId: safeString(auftrag?.orderId),
    summary: { customerName: safeString(customer?.name) },
    data: {
      profile: {
        type: safeString(customer?.type),
        customerType: safeString(customer?.type),
        companyName: isCompany ? safeString(customer?.companyName) || safeString(customer?.name) : "",
        firstName: isCompany ? "" : safeString(customer?.name),
        lastName: "",
        salutation: safeString(customer?.salutation),
        contactEmail: safeString(customer?.email),
        contactPhone: safeString(customer?.phone),
        street: safeString(address?.street),
        streetNo: safeString(address?.houseNumber),
        zip: safeString(address?.zip),
        city: safeString(address?.city),
        country: safeString(address?.country) || "CH",
      },
    },
  };
}

function sameContractRate(invoice: any, rate: ReturnType<typeof getHeatingInvoicePlan>["items"][number]) {
  const dueDate = invoice?.dueDate instanceof Date ? invoice.dueDate : invoice?.dueDate ? new Date(invoice.dueDate) : null;
  return safeString(invoice?.rateLabel ?? invoice?.label) === rate.label &&
    Math.abs(safeNumber(invoice?.pct, Number.NaN) - rate.pct) < 0.001 &&
    Math.abs(roundChf05(safeNumber(invoice?.amount, Number.NaN)) - rate.amount) < 0.009 &&
    (rate.dueDate ? dueDate?.toISOString() === rate.dueDate.toISOString() : dueDate == null);
}

export async function createHeatingInvoicesForOrder(args: {
  db: Db;
  companyId: string;
  auftrag: any;
  company: any;
  session: SessionPayload;
  now?: Date;
}) {
  const plan = getHeatingInvoicePlan(args.auftrag);
  await ensureInvoiceIndexes(args.db);
  const invoices = getInvoicesCollection(args.db);
  const orderId = safeString(args.auftrag?.orderId);
  const planningId = safeString(args.auftrag?.planningId?.toString?.() ?? args.auftrag?.planningId);
  if (!orderId || !planningId || safeString(args.auftrag?.status) === "storniert") {
    throw new HeatingInvoiceContractError("Ein aktiver kanonischer Heizungsauftrag ist erforderlich.", 400);
  }

  const now = args.now ?? new Date();
  const meta = getSessionUserMeta(args.session);
  const documentPlanning = buildHeatingInvoicePlanning(args.auftrag);
  const snapshot = args.auftrag.heatingOrderSnapshot;
  let createdCount = 0;

  for (const rate of plan.items) {
    const key = {
      companyId: args.companyId,
      orderId,
      projectType: "heating",
      invoiceType: "rechnung",
      rateIndex: rate.rateIndex,
    };
    const existing = await invoices.findOne(key);
    if (existing) {
      if (!sameContractRate(existing, rate)) {
        throw new HeatingInvoiceContractError(`Rate ${rate.rateIndex + 1} widerspricht dem Vertragssnapshot.`);
      }
      continue;
    }

    const invoiceNumber = await nextInvoiceNumber(args.db, args.companyId, now);
    const immutableSnapshot = {
      schemaVersion: 1,
      projectType: "heating",
      orderId,
      planningId,
      customer: snapshot.customer,
      objectAddress: snapshot.objectAddress,
      pricing: {
        totalGross: plan.totalGross,
        vatRate: safeNumber(snapshot?.pricing?.vatRate, 8.1),
      },
      paymentTerms: snapshot.paymentTerms,
      installment: {
        rateIndex: rate.rateIndex,
        label: rate.label,
        pct: rate.pct,
        amount: rate.amount,
        dueDate: rate.dueDateContract,
      },
    };
    const result = await invoices.updateOne(key, {
      $setOnInsert: {
        ...key,
        planningId,
        customerId: args.auftrag?.customerId ?? null,
        invoiceNumber,
        parentInvoiceId: null,
        position: rate.rateIndex,
        label: rate.label,
        rateLabel: rate.label,
        pct: rate.pct,
        percentage: rate.pct,
        amount: rate.amount,
        amountChf: rate.amount,
        currency: plan.currency,
        discountPct: 0,
        discountChf: 0,
        skontoPct: 0,
        skontoChf: 0,
        skontoDays: 0,
        mwstIncluded: true,
        vatRatePct: safeNumber(snapshot?.pricing?.vatRate, 8.1),
        positionMenge: 1,
        positionEinheit: "Pauschal",
        positionPreis: rate.amount,
        issueDate: now,
        dueDate: rate.dueDate,
        status: "entwurf",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: buildInvoiceAnrede(documentPlanning),
        bodyText: buildInvoiceDefaultBodyText({
          planning: documentPlanning,
          company: args.company,
          projectType: "heating",
          invoiceType: "rechnung",
          rateIndex: rate.rateIndex,
          pct: rate.pct,
          dueDate: rate.dueDate,
        }),
        internalNote: "",
        pdfFileId: null,
        qrReference: null,
        qrReferenceType: null,
        heatingInvoiceSnapshot: immutableSnapshot,
        createdAt: now,
        updatedAt: now,
        createdByUserId: toObjectIdOrNull(meta.id) ?? meta.id ?? null,
        createdByName: meta.name || "Unbekannt",
        createdByEmail: getSessionUserEmail(args.session) || null,
        dunningEligible: false,
        dunningLevel: 0,
      },
    }, { upsert: true });
    createdCount += result.upsertedCount;
  }

  const result = await invoices.find({
    companyId: args.companyId,
    orderId,
    projectType: "heating",
    invoiceType: "rechnung",
  }).sort({ rateIndex: 1, _id: 1 }).toArray();
  for (const invoice of result) {
    const rate = plan.items[Math.trunc(safeNumber(invoice?.rateIndex, -1))];
    if (!rate || !sameContractRate(invoice, rate)) {
      throw new HeatingInvoiceContractError("Bestehende Heizungsrechnung widerspricht dem Vertragssnapshot.");
    }
  }
  return { created: createdCount > 0, createdCount, invoices: result, plan };
}
