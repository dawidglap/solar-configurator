// src/app/api/catalog-items/[itemId]/route.ts
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

function safeNumber(v: any, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeBoolean(v: any, fallback = false) {
  return typeof v === "boolean" ? v : fallback;
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const origin = req.headers.get("origin");
  const { itemId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const objectId = toObjectIdOrNull(itemId);
  if (!objectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid itemId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection("catalogItems");

    const doc = await collection.findOne({
      _id: objectId,
      companyId: session.activeCompanyId,
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Catalog item not found" }, 404);
    }

    return jsonResponse(origin, { ok: true, item: normalizeCatalogItem(doc) }, 200);
  } catch (e: any) {
    console.error("GET CATALOG ITEM ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* --------------------------------- PATCH --------------------------------- */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const origin = req.headers.get("origin");
  const { itemId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const objectId = toObjectIdOrNull(itemId);
  if (!objectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid itemId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));

  const setObj: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (typeof body?.category === "string") setObj.category = safeString(body.category);
  if (typeof body?.subcategory === "string") setObj.subcategory = safeString(body.subcategory);
  if (typeof body?.brand === "string") setObj.brand = safeString(body.brand);
  if (typeof body?.model === "string") setObj.model = safeString(body.model);
  if (typeof body?.name === "string") setObj.name = safeString(body.name);
  if (typeof body?.description === "string") setObj.description = safeString(body.description);
  if (typeof body?.unit === "string") setObj.unit = safeString(body.unit);
  if (typeof body?.unitLabel === "string") setObj.unitLabel = safeString(body.unitLabel);
  if (typeof body?.priceNet === "number") setObj.priceNet = safeNumber(body.priceNet, 0);
  if (typeof body?.costNet === "number") setObj.costNet = safeNumber(body.costNet, 0);
  if (typeof body?.vatRate === "number") setObj.vatRate = safeNumber(body.vatRate, 8.1);
  if (typeof body?.isActive === "boolean") setObj.isActive = body.isActive;
  if (typeof body?.sortOrder === "number") setObj.sortOrder = safeNumber(body.sortOrder, 0);
  if (body?.metadata && typeof body.metadata === "object") setObj.metadata = body.metadata;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection("catalogItems");

    const res = await collection.updateOne(
      {
        _id: objectId,
        companyId: session.activeCompanyId,
      },
      { $set: setObj },
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Catalog item not found" }, 404);
    }

    const updated = await collection.findOne({
      _id: objectId,
      companyId: session.activeCompanyId,
    });

    return jsonResponse(
      origin,
      { ok: true, item: updated ? normalizeCatalogItem(updated) : null },
      200,
    );
  } catch (e: any) {
    console.error("PATCH CATALOG ITEM ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* -------------------------------- DELETE --------------------------------- */

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const origin = req.headers.get("origin");
  const { itemId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const objectId = toObjectIdOrNull(itemId);
  if (!objectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid itemId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection("catalogItems");

    const res = await collection.deleteOne({
      _id: objectId,
      companyId: session.activeCompanyId,
    });

    if (res.deletedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Catalog item not found" }, 404);
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE CATALOG ITEM ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500,
    );
  } finally {
    await client.close().catch(() => {});
  }
}