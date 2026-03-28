import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
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

  const token = getCookie(req, "session");
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Not logged in" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const [payload, sig] = token.split(".");
  if (!payload || !sig) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid session" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const expected = sign(payload, secret);
  if (expected !== sig) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid session" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  let session: any;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid session payload" }),
      {
        status: 401,
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
    const companies = db.collection("companies");

    const user: any = await users.findOne(
      { _id: new ObjectId(session.userId) },
      {
        projection: {
          passwordHash: 0,
        },
      }
    );

    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: "User not found" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(origin),
          },
        }
      );
    }

    let activeCompany = null;

    if (session.activeCompanyId) {
      activeCompany = await companies.findOne(
        { _id: new ObjectId(session.activeCompanyId) },
        {
          projection: {
            name: 1,
            slug: 1,
            subscriptionStatus: 1,
            plan: 1,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          isPlatformSuperAdmin: !!user.isPlatformSuperAdmin,
          status: user.status ?? "active",
        },
        session: {
          activeCompanyId: session.activeCompanyId ?? null,
          activeRole: session.activeRole ?? null,
          isPlatformSuperAdmin: !!session.isPlatformSuperAdmin,
        },
        activeCompany: activeCompany
          ? {
              id: activeCompany._id.toString(),
              name: activeCompany.name ?? "",
              slug: activeCompany.slug ?? "",
              subscriptionStatus: activeCompany.subscriptionStatus ?? "active",
              plan: activeCompany.plan ?? "pro",
            }
          : null,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  } catch (e: any) {
    console.error("ME ERROR:", e);

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