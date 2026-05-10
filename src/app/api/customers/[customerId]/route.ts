// src/app/api/customers/[customerId]/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import { activeDocumentFilter, buildSoftDeleteFields } from "@/lib/trash";
import {
  normalizeCustomerDoc,
  normalizeStoredCustomerEmail,
  normalizeStoredCustomerString,
  safeCustomerString,
} from "@/lib/customers";

export const runtime = "nodejs";
const CUSTOMER_DETAIL_CACHE_TTL_MS = 120_000;
const CUSTOMER_DETAIL_RATE_GUARD_MS = 1_500;

// Vercel Observability showed ~30k invocations on this route in 12h.
// Keep this endpoint lean and resilient against frontend loops by using:
// - lightweight projections
// - browser-private caching
// - per-instance micro-cache
// - per-user/customer rate guard
const customerDetailCache = new Map<
  string,
  {
    body: ReturnType<typeof normalizeCustomerDoc>;
    expiresAt: number;
  }
>();
const customerDetailLastRequestAt = new Map<string, number>();

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
  return safeCustomerString(v);
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

function getDebugLoggingEnabled() {
  return process.env.NODE_ENV === "development" || process.env.API_DEBUG === "true";
}

function getCachedCustomerHeaders(origin: string | null) {
  return {
    "Content-Type": "application/json",
    ...getCorsHeaders(origin),
    "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
    Vary: "Origin, Cookie",
  };
}

function jsonCachedCustomerResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: getCachedCustomerHeaders(origin),
  });
}

function buildCustomerCompanyFilter(companyId: string) {
  const objectId = toObjectIdOrNull(companyId);
  return objectId ? { $in: [companyId, objectId] } : companyId;
}

function getCacheKey(companyId: string, customerId: string) {
  return `${companyId}::${customerId}`;
}

function getRateGuardKey(companyId: string, userId: string, customerId: string) {
  return `${companyId}::${userId || "anonymous"}::${customerId}`;
}

function pruneCustomerDetailCache(now = Date.now()) {
  for (const [key, value] of customerDetailCache.entries()) {
    if (value.expiresAt <= now) {
      customerDetailCache.delete(key);
    }
  }
}

function logCustomerDetailRequest(args: {
  method: string;
  pathname: string;
  customerId: string;
  userId: string;
  companyId: string;
  origin: string | null;
  durationMs: number;
  status: number;
}) {
  if (!getDebugLoggingEnabled()) return;
  console.log(
    `[API] ${args.method} ${args.pathname} customer=${args.customerId} company=${args.companyId || "-"} user=${args.userId || "-"} origin=${args.origin || "-"} duration=${args.durationMs}ms status=${args.status}`,
  );
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
  { params }: { params: Promise<{ customerId: string }> },
) {
  const startedAt = Date.now();
  const origin = req.headers.get("origin");
  const { customerId } = await params;
  const pathname = new URL(req.url).pathname;

  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    const status = 500;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId: "",
      companyId: "",
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonResponse(origin, { ok: false, error: "Missing env" }, status);
  }

  const session = readSession(req, secret);
  if (!session) {
    const status = 401;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId: "",
      companyId: "",
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, status);
  }
  const companyId = safeString(session.activeCompanyId);
  const userId = safeString(session.userId);
  if (!companyId) {
    const status = 401;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonResponse(origin, { ok: false, error: "No active company" }, status);
  }

  const customerObjectId = toObjectIdOrNull(customerId);
  if (!customerObjectId) {
    const status = 400;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonResponse(origin, { ok: false, error: "Invalid customerId" }, status);
  }

  const cacheKey = getCacheKey(companyId, customerId);
  const rateGuardKey = getRateGuardKey(companyId, userId, customerId);
  const now = Date.now();
  pruneCustomerDetailCache(now);
  const cached = customerDetailCache.get(cacheKey);
  const lastRequestedAt = customerDetailLastRequestAt.get(rateGuardKey) ?? 0;

  if (cached && cached.expiresAt > now && now - lastRequestedAt < CUSTOMER_DETAIL_RATE_GUARD_MS) {
    customerDetailLastRequestAt.set(rateGuardKey, now);
    const status = 200;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonCachedCustomerResponse(origin, { ok: true, customer: cached.body }, status);
  }

  if (cached && cached.expiresAt > now) {
    customerDetailLastRequestAt.set(rateGuardKey, now);
    const status = 200;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonCachedCustomerResponse(origin, { ok: true, customer: cached.body }, status);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const customers = db.collection("customers");

    const doc = await customers.findOne(
      {
        _id: customerObjectId,
        companyId: buildCustomerCompanyFilter(companyId),
        ...activeDocumentFilter(),
      },
      {
        projection: {
          _id: 1,
          companyId: 1,
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
    );

    if (!doc) {
      const status = 404;
      logCustomerDetailRequest({
        method: req.method,
        pathname,
        customerId,
        userId,
        companyId,
        origin,
        durationMs: Date.now() - startedAt,
        status,
      });
      return jsonCachedCustomerResponse(origin, { ok: false, error: "Customer not found" }, status);
    }

    const customer = normalizeCustomerDoc(doc);
    customerDetailCache.set(cacheKey, {
      body: customer,
      expiresAt: now + CUSTOMER_DETAIL_CACHE_TTL_MS,
    });
    customerDetailLastRequestAt.set(rateGuardKey, now);

    const status = 200;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });

    return jsonCachedCustomerResponse(origin, {
      ok: true,
      customer,
    }, status);
  } catch (e: any) {
    console.error("GET CUSTOMER ERROR:", e);
    const status = 500;
    logCustomerDetailRequest({
      method: req.method,
      pathname,
      customerId,
      userId,
      companyId,
      origin,
      durationMs: Date.now() - startedAt,
      status,
    });
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      status
    );
  }
}

/* --------------------------------- PATCH --------------------------------- */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const origin = req.headers.get("origin");
  const { customerId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const customerObjectId = toObjectIdOrNull(customerId);
  if (!customerObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid customerId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));

  const setObj: Record<string, any> = {
    updatedAt: new Date(),
  };

  if ("type" in body) {
    setObj.type = body?.type === "company" ? "company" : "private";
  }

  if ("name" in body) {
    setObj.name = safeString(body?.name);
  }

  if ("firstName" in body) {
    setObj.firstName = normalizeStoredCustomerString(body?.firstName);
  }

  if ("lastName" in body) {
    setObj.lastName = normalizeStoredCustomerString(body?.lastName);
  }

  if ("companyName" in body) {
    setObj.companyName = normalizeStoredCustomerString(body?.companyName);
  }

  if ("email" in body) {
    setObj.email = normalizeStoredCustomerEmail(body?.email);
  }

  if ("phone" in body) {
    setObj.phone = safeString(body?.phone);
  }

  if ("address" in body) {
    setObj.address = safeString(body?.address);
  }

  if ("notes" in body) {
    setObj.notes = safeString(body?.notes);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const customers = db.collection("customers");

    const res = await customers.updateOne(
      {
        _id: customerObjectId,
        companyId: session.activeCompanyId,
        ...activeDocumentFilter(),
      },
      {
        $set: setObj,
      }
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Customer not found" }, 404);
    }

    const updated = await customers.findOne(
      {
        _id: customerObjectId,
        companyId: session.activeCompanyId,
        ...activeDocumentFilter(),
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
    );

    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Customer not found" }, 404);
    }

    return jsonResponse(origin, {
      ok: true,
      customer: normalizeCustomerDoc(updated),
    });
  } catch (e: any) {
    console.error("PATCH CUSTOMER ERROR:", e);
    if (e?.code === 11000) {
      return jsonResponse(
        origin,
        { ok: false, error: "Customer identity already exists" },
        409
      );
    }
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    customerDetailCache.delete(getCacheKey(safeString(session.activeCompanyId), customerId));
    await client.close().catch(() => {});
  }
}

/* --------------------------------- DELETE -------------------------------- */

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const origin = req.headers.get("origin");
  const { customerId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const customerObjectId = toObjectIdOrNull(customerId);
  if (!customerObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid customerId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;

    const customers = db.collection("customers");
    const plannings = db.collection("plannings");

    const deleteMeta = buildSoftDeleteFields(session as any);

    const res = await customers.updateOne(
      {
        _id: customerObjectId,
        companyId: session.activeCompanyId,
        ...activeDocumentFilter(),
      },
      {
        $set: deleteMeta,
      }
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Customer not found" }, 404);
    }

    await plannings.updateMany(
      {
        companyId: session.activeCompanyId,
        customerId,
        ...activeDocumentFilter(),
      },
      {
        $set: {
          ...deleteMeta,
          deletedCascadeParentType: "customer",
          deletedCascadeParentId: customerId,
        },
      }
    );

    return jsonResponse(origin, { ok: true, deletedCustomerId: customerId }, 200);
  } catch (e: any) {
    console.error("DELETE CUSTOMER ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    customerDetailCache.delete(getCacheKey(safeString(session.activeCompanyId), customerId));
    await client.close().catch(() => {});
  }
}
