import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import { normalizeOrderFields } from "@/lib/orders";

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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const { searchParams } = new URL(req.url);
    const match: Record<string, any> = {
      companyId: String(session.activeCompanyId),
      orderStatus: "generated",
    };

    const status = safeString(searchParams.get("status"));
    if (status) {
      match.orderStatus = status;
    }

    const customerId = safeString(searchParams.get("customerId"));
    if (customerId) {
      match.customerId = customerId;
    }

    const from = safeString(searchParams.get("from"));
    const to = safeString(searchParams.get("to"));
    if (from || to) {
      match.orderGeneratedAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) {
          match.orderGeneratedAt.$gte = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
          match.orderGeneratedAt.$lte = toDate;
        }
      }
    }

    const q = safeString(searchParams.get("q"));
    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");
      match.$or = [
        { orderId: regex },
        { title: regex },
        { planningNumber: regex },
        { "summary.customerName": regex },
        { "data.profile.companyName": regex },
        { "data.profile.firstName": regex },
        { "data.profile.lastName": regex },
        { "data.profile.contactFirstName": regex },
        { "data.profile.contactLastName": regex },
      ];
    }

    const docs = await db
      .collection("plannings")
      .aggregate([
        { $match: match },
        {
          $project: {
            title: 1,
            planningNumber: 1,
            customerId: 1,
            companyId: 1,
            summary: 1,
            data: 1,
            orderStatus: 1,
            orderId: 1,
            orderGeneratedAt: 1,
            orderSnapshotFileId: 1,
            angebotSnapshotFileId: 1,
          },
        },
        { $sort: { orderGeneratedAt: -1, _id: -1 } },
      ])
      .toArray();

    const items = await Promise.all(
      docs.map(async (doc: any) => {
        const commercial = await computePlanningCommercialSummary(db, doc);
        const orderFields = normalizeOrderFields(doc);
        return {
          ...orderFields,
          planningId: safeString(doc?._id?.toString?.() ?? doc?._id),
          customerId: safeString(doc?.customerId) || null,
          customerName: customerNameFromPlanning(doc),
          projectTitle: safeString(doc?.title) || safeString(doc?.planningNumber),
          totalInklMwst: commercial.grossPriceChf,
        };
      }),
    );

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET ORDERS ERROR:", e);
    return jsonResponse(origin, { ok: false, message: "Auftragsliste konnte nicht geladen werden." }, 500);
  }
}
