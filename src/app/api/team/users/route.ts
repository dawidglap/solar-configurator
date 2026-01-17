import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";

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
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret) return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const name = String(body.name ?? "").trim();
  const role = String(body.role ?? "sales").trim(); // sales|planner|viewer|admin
  const tempPassword = String(body.tempPassword ?? "").trim();

  if (!email || !tempPassword) {
    return Response.json(
      { ok: false, error: "Missing email or tempPassword" },
      { status: 400 }
    );
  }

  const allowedRoles = new Set(["owner", "admin", "sales", "planner", "viewer"]);
  if (!allowedRoles.has(role)) {
    return Response.json({ ok: false, error: "Invalid role" }, { status: 400 });
  }

  const activeCompanyId = session.activeCompanyId;
  if (!activeCompanyId) {
    return Response.json({ ok: false, error: "Missing activeCompanyId" }, { status: 400 });
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const users = db.collection("users");

    // check current user role (must be owner/admin)
    const currentUser = await users.findOne({ _id: new (require("mongodb").ObjectId)(session.userId) });
    const currentRole = currentUser?.memberships?.find((m: any) => String(m.companyId) === String(activeCompanyId))?.role;

    if (!currentRole || (currentRole !== "owner" && currentRole !== "admin")) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const existing = await users.findOne({ email });
    if (existing) {
      return Response.json({ ok: false, error: "User already exists" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const res = await users.insertOne({
      email,
      name: name || null,
      passwordHash,
      memberships: [{ companyId: activeCompanyId, role, status: "active" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return Response.json({
      ok: true,
      userId: res.insertedId.toString(),
      email,
      role,
      tempPassword, // solo per test, poi lo togliamo
    });
  } catch (e: any) {
    console.error("CREATE USER ERROR:", e);
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
