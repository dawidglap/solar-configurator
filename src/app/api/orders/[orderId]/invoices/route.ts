import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canWriteInvoices, ensureInvoiceIndexes, getInvoicesCollection, normalizeInvoice } from "@/lib/invoices";

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
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

  const { orderId } = await params;
  if (!safeString(orderId)) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const items = await getInvoicesCollection(db)
      .find({
        companyId: String(session.activeCompanyId),
        orderId: safeString(orderId),
      })
      .sort({ rateIndex: 1, createdAt: 1, _id: 1 })
      .toArray();

    return jsonResponse(origin, { ok: true, items: items.map((doc) => normalizeInvoice(doc)) }, 200);
  } catch (error: any) {
    console.error("GET ORDER INVOICES ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnungen konnten nicht geladen werden." }, 500);
  }
}

