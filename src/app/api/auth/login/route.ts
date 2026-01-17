// src/app/api/auth/login/route.ts
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function POST(req: Request) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return Response.json({ ok: false, error: "Missing email or password" }, { status: 400 });
  }

  // ✅ timeout corto così non resta appeso 30s
  const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  family: 4, // ✅ forza IPv4
});


  try {
    await client.connect();

    const db = client.db(); // usa il DB dalla connection string (/sola)
    const users = db.collection("users");

    const user: any = await users.findOne({ email });
    if (!user) {
      return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const passOk = await bcrypt.compare(password, user.passwordHash);
    if (!passOk) {
      return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const activeCompanyId = user.memberships?.[0]?.companyId;
    if (!activeCompanyId) {
      return Response.json({ ok: false, error: "User has no company" }, { status: 403 });
    }

    const sessionObj = {
      userId: user._id.toString(),
      activeCompanyId: activeCompanyId.toString(),
      iat: Date.now(),
    };

    const payload = Buffer.from(JSON.stringify(sessionObj)).toString("base64url");
    const sig = sign(payload, secret);
    const token = `${payload}.${sig}`;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      },
    });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  } finally {
    await client.close().catch(() => {});
  }
}
