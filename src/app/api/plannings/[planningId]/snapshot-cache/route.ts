import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

/* ---------------- Session helpers ---------------- */

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

function readSession(req: Request, secret: string) {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/* ---------------- Helpers ---------------- */

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

async function ensureIndexes(db: any) {
  const collection = db.collection("snapshotCache");

  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await collection.createIndex(
    { planningId: 1, companyId: 1 },
    { unique: true }
  );
}

/* ---------------- OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- POST ---------------- */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  let planningObjectId: ObjectId;

  try {
    planningObjectId = new ObjectId(planningId);
  } catch {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const body = await req.json().catch(() => null);

  const snapshotDataUrl =
    typeof body?.snapshotDataUrl === "string" ? body.snapshotDataUrl : "";

  if (!snapshotDataUrl.startsWith("data:image/")) {
    return jsonResponse(origin, {
      ok: false,
      error: "Invalid snapshotDataUrl",
    }, 400);
  }

  // safety limit circa 2 MB stringa base64
  if (snapshotDataUrl.length > 2_500_000) {
    return jsonResponse(origin, {
      ok: false,
      error: "Snapshot too large",
      length: snapshotDataUrl.length,
    }, 413);
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 6); // 6 ore

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();

    await ensureIndexes(db);

    const plannings = db.collection("plannings");
    const snapshotCache = db.collection("snapshotCache");

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    await snapshotCache.updateOne(
      {
        planningId,
        companyId: session.activeCompanyId,
      },
      {
        $set: {
          planningObjectId,
          planningId,
          companyId: session.activeCompanyId,
          snapshotDataUrl,
          type: typeof body?.type === "string" ? body.type : "module-layout",
          createdAt:
            typeof body?.createdAt === "string"
              ? new Date(body.createdAt)
              : now,
          updatedAt: now,
          expiresAt,
        },
      },
      { upsert: true }
    );

    return jsonResponse(origin, {
      ok: true,
      cached: true,
      planningId,
      expiresAt: expiresAt.toISOString(),
      length: snapshotDataUrl.length,
    });
  } catch (e: any) {
    console.error("POST SNAPSHOT CACHE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* ---------------- GET ---------------- */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();

    await ensureIndexes(db);

    const snapshotCache = db.collection("snapshotCache");

    const entry = await snapshotCache.findOne({
      planningId,
      companyId: session.activeCompanyId,
      expiresAt: { $gt: new Date() },
    });

    if (!entry) {
      return jsonResponse(origin, {
        ok: false,
        error: "Snapshot not found",
      }, 404);
    }

    return jsonResponse(origin, {
      ok: true,
      snapshot: {
        snapshotDataUrl: entry.snapshotDataUrl,
        type: entry.type,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      },
    });
  } catch (e: any) {
    console.error("GET SNAPSHOT CACHE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}