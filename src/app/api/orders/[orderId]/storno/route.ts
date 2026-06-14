import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { ensureInvoiceIndexes, getInvoicesCollection, normalizeInvoice } from "@/lib/invoices";
import { normalizeOrderFields } from "@/lib/orders";
import { getSessionUserId, getSessionUserName, isAdminLikeRole } from "@/lib/tasks";

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

function normalizePlanning(planning: any) {
  return {
    id: safeString(planning?._id?.toString?.() ?? planning?._id),
    title: safeString(planning?.title),
    planningNumber: safeString(planning?.planningNumber),
    customerId: safeString(planning?.customerId) || null,
    commercial: {
      stage: safeString(planning?.commercial?.stage) || "lead",
      valueChf: Number(planning?.commercial?.valueChf ?? 0),
    },
    ...normalizeOrderFields(planning),
  };
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

  if (!isAdminLikeRole(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  if (!normalizedOrderId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const reason = safeString(body?.reason);
  if (reason.length < 3) {
    return jsonResponse(origin, { ok: false, message: "Stornogrund muss mindestens 3 Zeichen haben." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const companyId = String(session.activeCompanyId);
    const plannings = db.collection("plannings");
    await ensureInvoiceIndexes(db);
    const invoices = getInvoicesCollection(db);

    const planning = await plannings.findOne({
      companyId,
      orderId: normalizedOrderId,
      orderStatus: "generated",
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }

    if (planning?.cancelledAt) {
      return jsonResponse(
        origin,
        {
          ok: false,
          message: "Auftrag ist bereits storniert.",
          order: {
            ...normalizeOrderFields(planning),
            state: "storniert",
          },
          planning: normalizePlanning(planning),
        },
        409,
      );
    }

    const now = new Date();
    const cancelledByUserId = toObjectIdOrNull(getSessionUserId(session)) ?? getSessionUserId(session) ?? null;
    const cancelledByName = getSessionUserName(session) || "Unbekannt";

    await plannings.updateOne(
      { _id: planning._id, companyId },
      {
        $set: {
          cancelledAt: now,
          cancelledByUserId,
          cancelledByName,
          cancelReason: reason,
          updatedAt: now,
        },
      },
    );

    await invoices.updateMany(
      {
        companyId,
        orderId: normalizedOrderId,
        invoiceType: { $in: ["rechnung", "mahnung"] },
        status: { $in: ["entwurf", "heruntergeladen", "versendet"] },
        paymentStatus: { $ne: "bezahlt" },
      },
      {
        $set: {
          status: "storniert",
          dunningEligible: false,
          updatedAt: now,
        },
      },
    );

    const updatedPlanning = await plannings.findOne({
      _id: planning._id,
      companyId,
    });
    const affectedInvoices = await invoices
      .find({
        companyId,
        orderId: normalizedOrderId,
      })
      .sort({ rateIndex: 1, createdAt: 1, _id: 1 })
      .toArray();

    return jsonResponse(
      origin,
      {
        ok: true,
        order: {
          ...normalizeOrderFields(updatedPlanning),
          state: "storniert",
        },
        planning: normalizePlanning(updatedPlanning),
        invoices: affectedInvoices.map((invoice) => normalizeInvoice(invoice)),
      },
      200,
    );
  } catch (error: any) {
    console.error("POST ORDER STORNO ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Auftrag konnte nicht storniert werden." }, 500);
  }
}
