import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canWriteInvoices, ensureInvoiceIndexes, getInvoicesCollection, normalizeInvoice } from "@/lib/invoices";
import { getOrderIdQuery } from "@/lib/orderIds";
import { resolveProjectType } from "@/lib/projectType";
import { getAuftraegeCollection } from "@/lib/auftragPipeline";
import {
  createHeatingInvoicesForOrder,
  getHeatingInvoicePlan,
  HeatingInvoiceContractError,
} from "@/lib/heatingInvoices";

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
    const planning = await db.collection("plannings").findOne({
      companyId: String(session.activeCompanyId),
      orderId: getOrderIdQuery(orderId),
      orderStatus: "generated",
    });
    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }
    const items = await getInvoicesCollection(db)
      .find({
        companyId: String(session.activeCompanyId),
        orderId: safeString(planning?.orderId),
      })
      .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
      .toArray();

    let plannedRates = null;
    if (resolveProjectType(planning?.projectType) === "heating") {
      const auftrag = await getAuftraegeCollection(db).findOne({
        companyId: String(session.activeCompanyId),
        orderId: safeString(planning?.orderId),
        projectType: "heating",
      });
      if (auftrag) plannedRates = getHeatingInvoicePlan(auftrag);
    }

    return jsonResponse(origin, {
      ok: true,
      projectType: resolveProjectType(planning?.projectType),
      plannedRates,
      items: items.map((doc) => normalizeInvoice(doc)),
    }, 200);
  } catch (error: any) {
    console.error("GET ORDER INVOICES ERROR:", error);
    if (error instanceof HeatingInvoiceContractError) {
      return jsonResponse(origin, { ok: false, message: error.message }, error.status);
    }
    return jsonResponse(origin, { ok: false, message: "Rechnungen konnten nicht geladen werden." }, 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canWriteInvoices(session)) return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);

  const { orderId } = await params;
  if (!safeString(orderId)) return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    const companyId = String(session.activeCompanyId);
    const planning = await db.collection("plannings").findOne({
      companyId,
      orderId: getOrderIdQuery(orderId),
      orderStatus: "generated",
    });
    if (!planning || planning?.cancelledAt) {
      return jsonResponse(origin, { ok: false, message: "Aktiver Auftrag nicht gefunden." }, 404);
    }
    if (resolveProjectType(planning?.projectType) !== "heating") {
      return jsonResponse(origin, { ok: false, message: "PV-Rechnungen werden unverändert bei der Auftragserstellung erzeugt." }, 409);
    }

    const auftrag = await getAuftraegeCollection(db).findOne({
      companyId,
      orderId: safeString(planning?.orderId),
      projectType: "heating",
      status: { $ne: "storniert" },
    });
    if (!auftrag) return jsonResponse(origin, { ok: false, message: "Kanonischer Heizungsauftrag nicht gefunden." }, 404);

    const companyObjectId = toObjectIdOrNull(companyId);
    const company = companyObjectId
      ? await db.collection("companies").findOne({ _id: companyObjectId })
      : null;
    const result = await createHeatingInvoicesForOrder({ db, companyId, auftrag, company, session });
    return jsonResponse(origin, {
      ok: true,
      created: result.created,
      createdCount: result.createdCount,
      plannedRates: result.plan,
      items: result.invoices.map((invoice) => normalizeInvoice(invoice)),
    });
  } catch (error: any) {
    console.error("POST HEATING ORDER INVOICES ERROR:", error);
    if (error instanceof HeatingInvoiceContractError) {
      return jsonResponse(origin, { ok: false, message: error.message }, error.status);
    }
    return jsonResponse(origin, { ok: false, message: "Heizungsrechnungen konnten nicht erstellt werden." }, 500);
  }
}
