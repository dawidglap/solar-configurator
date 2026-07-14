import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  ensureInvoiceIndexes,
  getInvoicesCollection,
  getPlannedInvoiceRates,
  normalizeInvoice,
} from "@/lib/invoices";
import { normalizeOrderFields } from "@/lib/orders";
import { ensureAuftragIndexes, getHydratedAuftragState } from "@/lib/auftragPipeline";
import { toObjectIdOrNull } from "@/lib/api-session";

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

function customerNameFromPlanning(planning: any) {
  return (
    safeString(planning?.summary?.customerName) ||
    safeString(planning?.data?.profile?.companyName) ||
    [
      safeString(planning?.data?.profile?.firstName || planning?.data?.profile?.contactFirstName),
      safeString(planning?.data?.profile?.lastName || planning?.data?.profile?.contactLastName),
    ]
      .filter(Boolean)
      .join(" ") ||
    ""
  );
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

  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  if (!normalizedOrderId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAuftragIndexes(db);

    const planning = await db.collection("plannings").findOne({
      companyId: String(session.activeCompanyId),
      orderId: normalizedOrderId,
      orderStatus: "generated",
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }

    await ensureInvoiceIndexes(db);
    const invoices = await getInvoicesCollection(db)
      .find({
        companyId: String(session.activeCompanyId),
        orderId: normalizedOrderId,
      })
      .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
      .toArray();
    const normalizedInvoices = invoices.map((invoice) => normalizeInvoice(invoice));

    const commercial = await computePlanningCommercialSummary(db, planning);
    const plannedRates = getPlannedInvoiceRates(planning);
    const companyObjectId = toObjectIdOrNull(String(session.activeCompanyId));
    const auftrag =
      companyObjectId
        ? await getHydratedAuftragState({
            db,
            companyId: companyObjectId,
            orderId: normalizedOrderId,
          })
        : null;

    return jsonResponse(
      origin,
      {
        ok: true,
        invoices: normalizedInvoices,
        stepsState: auftrag?.stepsState ?? [],
        checklist: auftrag?.checklist ?? null,
        order: {
          ...normalizeOrderFields(planning),
          planningId: safeString(planning?._id?.toString?.() ?? planning?._id),
          customerId: safeString(planning?.customerId) || null,
          customerName: customerNameFromPlanning(planning),
          projectTitle: safeString(planning?.title) || safeString(planning?.planningNumber),
          totalInklMwst: commercial.grossPriceChf,
          plannedRatesCount: plannedRates.ok ? plannedRates.items.length : 0,
          invoicesCount: normalizedInvoices.length,
          invoices: normalizedInvoices,
          currentStepKey: auftrag?.normalizedAuftrag.currentStepKey || null,
          completedAt: auftrag?.normalizedAuftrag.completedAt || null,
          auftragId: auftrag?.normalizedAuftrag.id || null,
        },
      },
      200,
    );
  } catch (error: any) {
    console.error("GET ORDER DETAIL ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Auftrag konnte nicht geladen werden." }, 500);
  }
}
