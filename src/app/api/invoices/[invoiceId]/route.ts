import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  canWriteInvoices,
  ensureInvoiceIndexes,
  getInvoiceByIdForCompany,
  getInvoicesCollection,
  normalizeInvoice,
} from "@/lib/invoices";

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
  const normalized = safeString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
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
    const invoice = await getInvoiceByIdForCompany(db, invoiceId, String(session.activeCompanyId));
    if (!invoice) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("GET INVOICE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnung konnte nicht geladen werden." }, 500);
  }
}

export async function PATCH(
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
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, message: "Ungültiger JSON-Body." }, 400);
  }

  const updateDoc: Record<string, any> = {
    updatedAt: new Date(),
  };

  if ("anrede" in body) updateDoc.anrede = safeString((body as any)?.anrede);
  if ("bodyText" in body) updateDoc.bodyText = safeString((body as any)?.bodyText);
  if ("internalNote" in body) updateDoc.internalNote = safeString((body as any)?.internalNote);
  if ("dueDate" in body) {
    const dueDate = parseDate((body as any)?.dueDate);
    if (!dueDate) {
      return jsonResponse(origin, { ok: false, message: "Fälligkeitsdatum ist ungültig." }, 400);
    }
    updateDoc.dueDate = dueDate;
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const invoices = getInvoicesCollection(db);
    const existing = await getInvoiceByIdForCompany(db, invoiceId, String(session.activeCompanyId));
    if (!existing) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    await invoices.updateOne(
      { _id: existing._id },
      {
        $set: updateDoc,
      },
    );

    const invoice = await invoices.findOne({ _id: existing._id });
    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("PATCH INVOICE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnung konnte nicht gespeichert werden." }, 500);
  }
}

