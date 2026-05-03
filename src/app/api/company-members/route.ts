import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession } from "@/lib/api-session";
import {
  ensureTaskIndexes,
  isActiveCompanyMember,
  jsonResponse,
  normalizeCompanyMember,
} from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(origin),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const activeCompanyId = String(session.activeCompanyId);

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    const docs = await db
      .collection("users")
      .find({ status: "active" })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .toArray();

    const items = docs
      .filter((doc) => isActiveCompanyMember(doc, activeCompanyId))
      .map((doc) => normalizeCompanyMember(doc, activeCompanyId));

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET COMPANY MEMBERS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

