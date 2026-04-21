import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

/* ----------------------------- Session helpers ---------------------------- */

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

/* -------------------------------- Helpers -------------------------------- */

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function toObjectIdOrNull(v: any) {
  try {
    if (!v) return null;
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function getBaseUrl(req: Request) {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (process.env.NODE_ENV === "development" ? "http" : "https");

  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host");

  if (!host) {
    throw new Error("Missing host header");
  }

  return `${proto}://${host}`;
}

/* ---------------------------------- POST --------------------------------- */

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
  if (!session) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();

    const plannings = db.collection("plannings");

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const baseUrl = getBaseUrl(req);
    const cookie = req.headers.get("cookie") || "";

    // Reuse the existing parts-defaults route instead of importing route.ts helpers
    const defaultsRes = await fetch(
      `${baseUrl}/api/plannings/${planningId}/parts-defaults`,
      {
        method: "GET",
        headers: {
          cookie,
        },
        cache: "no-store",
      }
    );

    const defaultsData = await defaultsRes.json().catch(() => null);

    if (!defaultsRes.ok || !defaultsData?.ok) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error:
            defaultsData?.error ||
            defaultsData?.message ||
            "Failed to load parts defaults",
        },
        500
      );
    }

    const defaultItems = Array.isArray(defaultsData?.items)
      ? defaultsData.items
      : [];

    const existingParts = (planning as any)?.data?.parts ?? {};

    await plannings.updateOne(
      {
        _id: planningObjectId,
        companyId: session.activeCompanyId,
      },
      {
        $set: {
          "data.parts": {
            ...existingParts,
            items: defaultItems,
          },
          updatedAt: new Date(),
        },
      }
    );

    return jsonResponse(origin, {
      ok: true,
      itemsCount: defaultItems.length,
      items: defaultItems,
    });
  } catch (e: any) {
    console.error("SYNC PARTS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}