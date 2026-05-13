import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import { normalizeExecutionRoles } from "@/lib/executionTasks";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
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
  const expected = sign(payload, secret);
  if (expected !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session) return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const name = String(body.name ?? "").trim();
  const role = String(body.role ?? "sales").trim(); // sales|planner|viewer|admin
  const tempPassword = String(body.tempPassword ?? "").trim();
  const executionRoles = normalizeExecutionRoles(body.executionRoles);

  if (!email || !tempPassword) {
    return jsonResponse(
      origin,
      { ok: false, error: "Missing email or tempPassword" },
      400
    );
  }

  const allowedRoles = new Set(["owner", "admin", "sales", "planner", "viewer"]);
  if (!allowedRoles.has(role)) {
    return jsonResponse(origin, { ok: false, error: "Invalid role" }, 400);
  }

  const activeCompanyId = session.activeCompanyId;
  if (!activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Missing activeCompanyId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const users = db.collection("users");

    // check current user role (must be owner/admin)
    const currentUser = await users.findOne({ _id: new (require("mongodb").ObjectId)(session.userId) });
    const currentRole = currentUser?.memberships?.find((m: any) => String(m.companyId) === String(activeCompanyId))?.role;

    if (!currentRole || (currentRole !== "owner" && currentRole !== "admin")) {
      return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
    }

    const existing = await users.findOne({ email });
    if (existing) {
      return jsonResponse(origin, { ok: false, error: "User already exists" }, 400);
    }

    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const res = await users.insertOne({
      email,
      name: name || null,
      passwordHash,
      executionRoles,
      memberships: [{ companyId: activeCompanyId, role, status: "active" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return jsonResponse(origin, {
      ok: true,
      userId: res.insertedId.toString(),
      email,
      role,
      executionRoles,
      tempPassword, // solo per test, poi lo togliamo
    });
  } catch (e: any) {
    console.error("CREATE USER ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message ?? "Unknown error" }, 500);
  } finally {
    await client.close().catch(() => {});
  }
}
