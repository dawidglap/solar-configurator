import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildInvoiceDefaultBodyText,
  canWriteInvoices,
  ensureInvoiceIndexes,
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
    if (!["rechnung", "mahnung"].includes(safeString(parentInvoice?.invoiceType))) {
      return jsonResponse(origin, { ok: false, message: "Gutschriften können nur aus Rechnungen oder Mahnungen erstellt werden." }, 400);
    }

    const now = new Date();
    const invoiceNumber = await nextInvoiceNumber(db, String(session.activeCompanyId), "gutschrift", now);
    const meta = getSessionUserMeta(session);
    const createdByUserId = toObjectIdOrNull(meta.id) ?? meta.id ?? null;
    const amount = -Math.abs(safeNumber(parentInvoice?.amount, 0));

    const doc = {
      companyId: String(session.activeCompanyId),
      planningId: safeString(parentInvoice?.planningId),
      orderId: safeString(parentInvoice?.orderId),
      invoiceNumber,
      invoiceType: "gutschrift",
      parentInvoiceId: parentInvoice._id,
      rateIndex: safeNumber(parentInvoice?.rateIndex, 0),
      rateLabel: `${invoiceNumber}-${safeNumber(parentInvoice?.rateIndex, 0) + 1}`,
      pct: safeNumber(parentInvoice?.pct, 0),
      amount,
      currency: safeString(parentInvoice?.currency) || "CHF",
      issueDate: now,
      dueDate: now,
      status: "entwurf",
      paymentStatus: "offen",
      paidAt: null,
      paidAmount: 0,
      anrede: safeString(parentInvoice?.anrede),
      bodyText: buildInvoiceDefaultBodyText({
        planning: context.planning,
        company: context.company,
        invoiceType: "gutschrift",
        rateIndex: safeNumber(parentInvoice?.rateIndex, 0),
        pct: safeNumber(parentInvoice?.pct, 0),
        dueDate: now,
      }),
      internalNote: "",
      pdfFileId: null,
      createdAt: now,
      updatedAt: now,
      createdByUserId,
      createdByName: meta.name || "Unbekannt",
      createdByEmail: getSessionUserEmail(session) || null,
      dunningEligible: false,
      dunningLevel: 0,
    };

    const invoices = db.collection("invoices");
    const insert = await invoices.insertOne(doc);
    const invoice = await invoices.findOne({ _id: insert.insertedId });
    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("POST INVOICE CREDIT NOTE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Gutschrift konnte nicht erstellt werden." }, 500);
  }
}

