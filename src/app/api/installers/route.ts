import { getDb } from "@/lib/db";
import {
  readSession,
  jsonResponse,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { getCorsHeaders } from "@/lib/cors";
import {
  ensureMontageIndexes,
  getUsersCollection,
  isUserInstallerForCompany,
  normalizeInstaller,
} from "@/lib/montages";

export const runtime = "nodejs";

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
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const activeCompanyId = String(session.activeCompanyId);
  const activeCompanyObjectId = toObjectIdOrNull(activeCompanyId);
  if (!activeCompanyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const users = getUsersCollection(db);
    const docs = await users
      .find({
        status: "active",
      })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .toArray();

    const items = docs
      .filter((doc) =>
        isUserInstallerForCompany(doc, activeCompanyId, activeCompanyObjectId)
      )
      .map((doc) => normalizeInstaller(doc, activeCompanyId, activeCompanyObjectId));

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET INSTALLERS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
