import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canManageCompanyBank, toCompanyObjectId } from "@/lib/orders";

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

function normalizeCompanyBank(company: any) {
  return {
    id: safeString(company?._id?.toString?.() ?? company?._id),
    name: safeString(company?.name),
    bank: {
      bankName: safeString(company?.bank?.bankName),
      iban: safeString(company?.bank?.iban),
      accountHolder: safeString(company?.bank?.accountHolder),
      bicSwift: safeString(company?.bank?.bicSwift),
    },
    paymentDefaults: {
      termDays: Number(company?.paymentDefaults?.termDays ?? 30),
      currency: safeString(company?.paymentDefaults?.currency) || "CHF",
    },
    updatedAt:
      company?.updatedAt instanceof Date
        ? company.updatedAt.toISOString()
        : safeString(company?.updatedAt) || null,
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  if (!canManageCompanyBank(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, message: "Ungültiger JSON-Body." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const companyId = String(session.activeCompanyId);
    const companyObjectId = toCompanyObjectId(companyId);
    const companies = db.collection("companies");

    await companies.updateOne(
      { _id: companyObjectId },
      {
        $set: {
          bank: {
            bankName: safeString(body?.bank?.bankName),
            iban: safeString(body?.bank?.iban),
            accountHolder: safeString(body?.bank?.accountHolder),
            bicSwift: safeString(body?.bank?.bicSwift),
          },
          paymentDefaults: {
            termDays: Math.max(0, Number(body?.paymentDefaults?.termDays ?? 30) || 30),
            currency: safeString(body?.paymentDefaults?.currency) || "CHF",
          },
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: false },
    );

    const company = await companies.findOne({ _id: companyObjectId });
    if (!company) {
      return jsonResponse(origin, { ok: false, message: "Firma nicht gefunden." }, 404);
    }

    return jsonResponse(origin, { ok: true, company: normalizeCompanyBank(company) }, 200);
  } catch (e: any) {
    console.error("PATCH COMPANY BANK ERROR:", e);
    return jsonResponse(origin, { ok: false, message: "Bankdaten konnten nicht gespeichert werden." }, 500);
  }
}
