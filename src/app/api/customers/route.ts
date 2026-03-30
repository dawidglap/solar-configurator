// src/app/api/customers/route.ts
import { MongoClient } from "mongodb";
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

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

/* -------------------------------- OPTIONS -------------------------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing env" }),
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return new Response(
      JSON.stringify({ ok: false, error: "Not logged in" }),
      { status: 401, headers: getCorsHeaders(origin) }
    );
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const customers = db.collection("customers");

    const docs = await customers
      .find(
        { companyId: session.activeCompanyId },
        {
          projection: {
            _id: 1,
            type: 1,
            name: 1,
            firstName: 1,
            lastName: 1,
            companyName: 1,
            email: 1,
            phone: 1,
            address: 1,
            notes: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        }
      )
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray();

    const items = docs.map((d: any) => ({
      id: String(d._id),
      type: d.type ?? "private",
      name:
        safeString(d.name) ||
        safeString(d.companyName) ||
        [safeString(d.firstName), safeString(d.lastName)]
          .filter(Boolean)
          .join(" ")
          .trim(),
      firstName: d.firstName ?? "",
      lastName: d.lastName ?? "",
      companyName: d.companyName ?? "",
      email: d.email ?? "",
      phone: d.phone ?? "",
      address: d.address ?? "",
      notes: d.notes ?? "",
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    }));

    return new Response(JSON.stringify({ ok: true, items }), {
      status: 200,
      headers: getCorsHeaders(origin),
    });
  } catch (e: any) {
    console.error("GET CUSTOMERS ERROR:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      { status: 500, headers: getCorsHeaders(origin) }
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* ---------------------------------- POST --------------------------------- */

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing env" }),
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return new Response(
      JSON.stringify({ ok: false, error: "Not logged in" }),
      { status: 401, headers: getCorsHeaders(origin) }
    );
  }

  const body = await req.json().catch(() => ({} as any));

  const type = body?.type === "company" ? "company" : "private";

  const doc = {
    companyId: session.activeCompanyId,
    type,
    name: safeString(body?.name),
    firstName: safeString(body?.firstName),
    lastName: safeString(body?.lastName),
    companyName: safeString(body?.companyName),
    email: safeString(body?.email),
    phone: safeString(body?.phone),
    address: safeString(body?.address),
    notes: safeString(body?.notes),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const customers = db.collection("customers");

    const res = await customers.insertOne(doc);

    return new Response(
      JSON.stringify({
        ok: true,
        customerId: res.insertedId.toString(),
      }),
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (e: any) {
    console.error("CREATE CUSTOMER ERROR:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      { status: 500, headers: getCorsHeaders(origin) }
    );
  } finally {
    await client.close().catch(() => {});
  }
}