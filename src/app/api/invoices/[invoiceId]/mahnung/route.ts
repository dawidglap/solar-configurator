import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildInvoiceDefaultBodyText,
  canWriteInvoices,
  ensureInvoiceIndexes,
  getInvoiceByIdForCompany,
  getInvoicesCollection,
  nextInvoiceNumber,
  normalizeInvoice,
} from "@/lib/invoices";
import { getInvoiceContextById } from "@/lib/invoicePdf";
import { getSessionUserEmail, getSessionUserMeta, safeNumber } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(0, Math.trunc(days)));
  return next;
}

function getDunningFee(company: any, level: number) {
  const fees = company?.paymentDefaults?.dunningFees;
  if (Array.isArray(fees)) {
    return Math.max(0, safeNumber(fees[level - 1], 0));
  }
  if (fees && typeof fees === "object") {
    return Math.max(0, safeNumber(fees[level] ?? fees[String(level)], 0));
  }
  return 0;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  if (!canWriteInvoices(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { invoiceId } = await params;

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const context = await getInvoiceContextById({
      db,
      companyId: String(session.activeCompanyId),
      invoiceId,
    });

    if (!context) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    const parentInvoice = context.invoice;
    if (safeString(parentInvoice?.invoiceType) !== "rechnung") {
      return jsonResponse(origin, { ok: false, message: "Mahnungen können nur aus Rechnungen erstellt werden." }, 400);
    }

    if (safeString(parentInvoice?.paymentStatus) === "bezahlt") {
      return jsonResponse(origin, { ok: false, message: "Für bezahlte Rechnungen ist keine Mahnung möglich." }, 400);
    }

    const dueDate = parentInvoice?.dueDate instanceof Date ? parentInvoice.dueDate : new Date(parentInvoice?.dueDate);
    const now = new Date();
    if (!parentInvoice?.dunningEligible && !(dueDate instanceof Date && dueDate.getTime() < now.getTime())) {
      return jsonResponse(origin, { ok: false, message: "Mahnung ist noch nicht fällig." }, 400);
    }

    const invoices = getInvoicesCollection(db);
    const existingLevel = await invoices.countDocuments({
      companyId: String(session.activeCompanyId),
      parentInvoiceId: parentInvoice._id,
      invoiceType: "mahnung",
    });
    const dunningLevel = existingLevel + 1;
    const fee = getDunningFee(context.company, dunningLevel);
    const openAmount = Math.max(0, safeNumber(parentInvoice?.amount, 0) - safeNumber(parentInvoice?.paidAmount, 0));
    const amount = Math.round((openAmount + fee) * 20) / 20;
    const issueDate = now;
    const nextDueDate = addDays(now, safeNumber(context.company?.paymentDefaults?.dunningTermDays, 10));
    const invoiceNumber = await nextInvoiceNumber(db, String(session.activeCompanyId), "mahnung", now);
    const meta = getSessionUserMeta(session);
    const createdByUserId = toObjectIdOrNull(meta.id) ?? meta.id ?? null;

    const doc = {
      companyId: String(session.activeCompanyId),
      planningId: safeString(parentInvoice?.planningId),
      orderId: safeString(parentInvoice?.orderId),
      invoiceNumber,
      invoiceType: "mahnung",
      parentInvoiceId: parentInvoice._id,
      rateIndex: safeNumber(parentInvoice?.rateIndex, 0),
      rateLabel: `${invoiceNumber}-${safeNumber(parentInvoice?.rateIndex, 0) + 1}`,
      pct: safeNumber(parentInvoice?.pct, 0),
      amount,
      baseAmount: openAmount,
      currency: safeString(parentInvoice?.currency) || "CHF",
      issueDate,
      dueDate: nextDueDate,
      status: "mahnung",
      paymentStatus: "offen",
      paidAt: null,
      paidAmount: 0,
      anrede: safeString(parentInvoice?.anrede),
      bodyText: buildInvoiceDefaultBodyText({
        planning: context.planning,
        company: context.company,
        invoiceType: "mahnung",
        rateIndex: safeNumber(parentInvoice?.rateIndex, 0),
        pct: safeNumber(parentInvoice?.pct, 0),
        dueDate: nextDueDate,
        dunningLevel,
      }),
      internalNote: "",
      pdfFileId: null,
      createdAt: now,
      updatedAt: now,
      createdByUserId,
      createdByName: meta.name || "Unbekannt",
      createdByEmail: getSessionUserEmail(session) || null,
      dunningEligible: false,
      dunningLevel,
    };

    const insert = await invoices.insertOne(doc);
    const invoice = await invoices.findOne({ _id: insert.insertedId });
    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("POST INVOICE DUNNING ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Mahnung konnte nicht erstellt werden." }, 500);
  }
}

