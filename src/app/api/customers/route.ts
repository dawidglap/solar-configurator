// src/app/api/customers/route.ts
import { MongoClient } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";
import {
  buildCustomerDedupFilter,
  ensureCustomerIndexes,
  normalizeCustomerDoc,
  normalizeStoredCustomerEmail,
  normalizeStoredCustomerString,
  safeCustomerString,
} from "@/lib/customers";

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
  return safeCustomerString(v);
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
    await ensureCustomerIndexes(db);

    const docs = await customers
      .find(
        {
          companyId: session.activeCompanyId,
          duplicateOfCustomerId: null,
        },
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
      ...normalizeCustomerDoc(d),
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
    firstName: normalizeStoredCustomerString(body?.firstName),
    lastName: normalizeStoredCustomerString(body?.lastName),
    companyName: normalizeStoredCustomerString(body?.companyName),
    email: normalizeStoredCustomerEmail(body?.email),
    phone: safeString(body?.phone),
    address: safeString(body?.address),
    notes: safeString(body?.notes),
    updatedAt: new Date(),
  };

  const dedupTarget = buildCustomerDedupFilter({
    companyId: session.activeCompanyId,
    type,
    email: doc.email,
    companyName: doc.companyName,
    firstName: doc.firstName,
    lastName: doc.lastName,
  });

  if (dedupTarget.key === "companyName" && !doc.companyName) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing companyName for company customer",
      }),
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  if (
    dedupTarget.key === "personName" &&
    !doc.firstName &&
    !doc.lastName
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing firstName/lastName for private customer without email",
      }),
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const customers = db.collection("customers");
    await ensureCustomerIndexes(db);

    const now = new Date();
    const result = await customers.findOneAndUpdate(
      dedupTarget.filter,
      {
        $setOnInsert: {
          ...doc,
          createdAt: now,
        },
        $set: {
          updatedAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        includeResultMetadata: true,
      }
    );

    const customer = result.value;

    if (!customer) {
      throw new Error("Customer upsert did not return a document");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        customer: normalizeCustomerDoc(customer),
        deduped: !!result.lastErrorObject?.updatedExisting,
      }),
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (e: any) {
    console.error("CREATE CUSTOMER ERROR:", e);
    if (e?.code === 11000) {
      try {
        const existing = await client
          .db()
          .collection("customers")
          .findOne(dedupTarget.filter);

        if (existing) {
          return new Response(
            JSON.stringify({
              ok: true,
              customer: normalizeCustomerDoc(existing),
              deduped: true,
            }),
            { status: 200, headers: getCorsHeaders(origin) }
          );
        }
      } catch (lookupError) {
        console.error("CREATE CUSTOMER DUPLICATE LOOKUP ERROR:", lookupError);
      }
    }
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      { status: 500, headers: getCorsHeaders(origin) }
    );
  } finally {
    await client.close().catch(() => {});
  }
}
