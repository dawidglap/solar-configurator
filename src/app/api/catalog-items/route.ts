// src/app/api/catalog-items/route.ts
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

/* -------------------------------- Helpers -------------------------------- */

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: any, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeBoolean(v: any, fallback = false) {
  return typeof v === "boolean" ? v : fallback;
}

function safeStringArray(v: any) {
  return Array.isArray(v)
    ? v.map((x) => safeString(x)).filter(Boolean)
    : [];
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

function normalizeCatalogItem(doc: any) {
  return {
    id: String(doc._id),
    companyId: doc.companyId ?? null,
    category: safeString(doc.category),
    subcategory: safeString(doc.subcategory),
    brand: safeString(doc.brand),
    model: safeString(doc.model),
    name: safeString(doc.name),
    description: safeString(doc.description),
    longDescription: safeString(doc.longDescription),
    features: safeStringArray(doc.features),
    warranty: safeString(doc.warranty),
    compatibility: safeString(doc.compatibility),
    notes: safeString(doc.notes),
    pdfSection: safeString(doc.pdfSection),
    unit: safeString(doc.unit) || "piece",
    unitLabel: safeString(doc.unitLabel) || "Stk.",
    priceNet: safeNumber(doc.priceNet, 0),
    costNet: safeNumber(doc.costNet, 0),
    vatRate: safeNumber(doc.vatRate, 8.1),
    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    sortOrder: safeNumber(doc.sortOrder, 0),
    metadata: doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {},
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
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
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { searchParams } = new URL(req.url);
  const category = safeString(searchParams.get("category"));
  const activeOnly = searchParams.get("activeOnly") === "true";

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection("catalogItems");

    const filter: Record<string, any> = {
      companyId: session.activeCompanyId,
    };

    if (category) {
      filter.category = category;
    }

    if (activeOnly) {
      filter.isActive = true;
    }

    const docs = await collection
      .find(filter)
      .sort({ category: 1, sortOrder: 1, name: 1, createdAt: -1 })
      .toArray();

    const items = docs.map(normalizeCatalogItem);

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET CATALOG ITEMS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500,
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
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const body = await req.json().catch(() => ({} as any));

  const category = safeString(body?.category);
  const name = safeString(body?.name);

  if (!category) {
    return jsonResponse(origin, { ok: false, error: "category is required" }, 400);
  }

  if (!name) {
    return jsonResponse(origin, { ok: false, error: "name is required" }, 400);
  }

  const now = new Date();

  const doc = {
    companyId: session.activeCompanyId,
    category,
    subcategory: safeString(body?.subcategory),
    brand: safeString(body?.brand),
    model: safeString(body?.model),
    name,
    description: safeString(body?.description),
    longDescription: safeString(body?.longDescription),
    features: safeStringArray(body?.features),
    warranty: safeString(body?.warranty),
    compatibility: safeString(body?.compatibility),
    notes: safeString(body?.notes),
    pdfSection: safeString(body?.pdfSection),
    unit: safeString(body?.unit) || "piece",
    unitLabel: safeString(body?.unitLabel) || "Stk.",
    priceNet: safeNumber(body?.priceNet, 0),
    costNet: safeNumber(body?.costNet, 0),
    vatRate: safeNumber(body?.vatRate, 8.1),
    isActive: safeBoolean(body?.isActive, true),
    sortOrder: safeNumber(body?.sortOrder, 0),
    metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
    createdAt: now,
    updatedAt: now,
  };

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection("catalogItems");

    const res = await collection.insertOne(doc);

    return jsonResponse(
      origin,
      {
        ok: true,
        itemId: res.insertedId.toString(),
      },
      200,
    );
  } catch (e: any) {
    console.error("CREATE CATALOG ITEM ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500,
    );
  } finally {
    await client.close().catch(() => {});
  }
}