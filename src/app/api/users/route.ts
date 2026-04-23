import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

/* ---------------- CORS OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

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

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
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

function normalizeUser(doc: any, activeCompanyId: string) {
  const memberships = Array.isArray(doc?.memberships) ? doc.memberships : [];
  const membership = memberships.find(
    (m: any) => String(m?.companyId) === String(activeCompanyId)
  );

  const firstName = safeString(doc?.firstName);
  const lastName = safeString(doc?.lastName);
  const fallbackName = safeString(doc?.name);

  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") || fallbackName || safeString(doc?.email);

  return {
    id: String(doc?._id ?? ""),
    firstName,
    lastName,
    name: fullName,
    email: safeString(doc?.email),
    role: safeString(membership?.role) || "",
    status: safeString(membership?.status) || "active",
    isPlatformSuperAdmin: !!doc?.isPlatformSuperAdmin,
    createdAt: doc?.createdAt ?? null,
    updatedAt: doc?.updatedAt ?? null,
  };
}

/* ---------------- GET ---------------- */

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

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

  const activeCompanyId = String(session.activeCompanyId);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const users = db.collection("users");

    const docs = await users
      .find({
        memberships: {
          $elemMatch: {
            companyId: activeCompanyId,
          },
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    const items = docs.map((doc) => normalizeUser(doc, activeCompanyId));

    return jsonResponse(origin, { ok: true, users: items }, 200);
  } catch (e: any) {
    console.error("GET USERS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}