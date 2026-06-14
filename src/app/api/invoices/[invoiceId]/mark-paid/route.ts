import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  canManageInvoicePayments,
  computeInvoicePaymentStatus,
  ensureInvoiceIndexes,
  getInvoiceByIdForCompany,
  getInvoicesCollection,
  normalizeInvoice,
} from "@/lib/invoices";
import { safeNumber } from "@/lib/tasks";

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

function parseDate(value: unknown) {
  if (value instanceof Date) return value;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
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

  if (!canManageInvoicePayments(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const body = await req.json().catch(() => ({} as any));
  const { invoiceId } = await params;

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const existing = await getInvoiceByIdForCompany(db, invoiceId, String(session.activeCompanyId));
    if (!existing) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    const paidAmount = safeNumber(body?.paidAmount, safeNumber(existing?.amount, 0));
    const paidAt = parseDate(body?.paidAt) ?? new Date();
    const paymentStatus = computeInvoicePaymentStatus(safeNumber(existing?.amount, 0), paidAmount);

    const invoices = getInvoicesCollection(db);
    await invoices.updateOne(
      { _id: existing._id },
      {
        $set: {
          paidAmount,
          paidAt,
          paymentStatus,
          updatedAt: new Date(),
        },
      },
    );

    const invoice = await invoices.findOne({ _id: existing._id });
    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("POST INVOICE MARK-PAID ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Zahlungsstatus konnte nicht aktualisiert werden." }, 500);
  }
}

