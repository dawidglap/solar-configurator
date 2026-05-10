import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";

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

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret) {
    return jsonResponse(origin, { ok: false, message: "Missing CRON_SECRET" }, 500);
  }
  if (!provided || provided !== cronSecret) {
    return jsonResponse(origin, { ok: false, message: "Forbidden" }, 403);
  }

  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const docs = await companies.find({ deletedAt: { $exists: false } }).project({
      subscriptionStatus: 1,
      validUntil: 1,
    }).toArray();

    const now = Date.now();
    let updated = 0;

    for (const company of docs) {
      const validUntil = company?.validUntil instanceof Date ? company.validUntil : new Date(company?.validUntil);
      if (Number.isNaN(validUntil.getTime())) continue;

      let nextStatus: "active" | "expiring_soon" | "suspended" = "active";
      if (validUntil.getTime() <= now) {
        nextStatus = "suspended";
      } else if (validUntil.getTime() - now <= 7 * 24 * 60 * 60 * 1000) {
        nextStatus = "expiring_soon";
      }

      if (company.subscriptionStatus !== nextStatus) {
        await companies.updateOne(
          { _id: company._id },
          { $set: { subscriptionStatus: nextStatus, updatedAt: new Date() } },
        );
        updated += 1;
      }
    }

    return jsonResponse(origin, { ok: true, updated });
  } catch (e: any) {
    console.error("CRON SUBSCRIPTION STATUS ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
