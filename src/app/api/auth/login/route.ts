// src/app/api/auth/login/route.ts
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
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
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing MONGODB_URI" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  if (!secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SESSION_SECRET" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing email or password" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    family: 4,
  });

  try {
    await client.connect();

    const db = client.db();
    const users = db.collection("users");

    const user: any = await users.findOne({ email });

    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid credentials" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(origin),
          },
        }
      );
    }

    const passOk = await bcrypt.compare(password, user.passwordHash);

    if (!passOk) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid credentials" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(origin),
          },
        }
      );
    }

    const membership =
      user.memberships?.find((m: any) => m.status === "active" && m.isDefault) ||
      user.memberships?.[0];

    if (!membership && !user.isPlatformSuperAdmin) {
      return new Response(
        JSON.stringify({ ok: false, error: "User has no active company" }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(origin),
          },
        }
      );
    }

    const activeCompanyId = membership?.companyId ?? null;
    const activeRole = membership?.role ?? null;

    if (!activeCompanyId && !user.isPlatformSuperAdmin) {
      return new Response(
        JSON.stringify({ ok: false, error: "User has no company" }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(origin),
          },
        }
      );
    }

    const sessionObj = {
      userId: user._id.toString(),
      isPlatformSuperAdmin: !!user.isPlatformSuperAdmin,
      activeCompanyId: activeCompanyId?.toString() ?? null,
      activeRole,
      iat: Date.now(),
    };

    const payload = Buffer.from(JSON.stringify(sessionObj)).toString("base64url");
    const sig = sign(payload, secret);
    const token = `${payload}.${sig}`;

    const isProd = process.env.NODE_ENV === "production";

    const cookieParts = [
      `session=${token}`,
      "Path=/",
      "HttpOnly",
    ];

    if (isProd) {
      cookieParts.push("Secure");
      cookieParts.push("Domain=.helionic.ch");
      cookieParts.push("SameSite=None");
    } else {
      cookieParts.push("SameSite=Lax");
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookieParts.join("; "),
        ...getCorsHeaders(origin),
      },
    });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);

    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  } finally {
    await client.close().catch(() => {});
  }
}