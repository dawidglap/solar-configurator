import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import {
  buildCompanySubscriptionResponse,
  buildSubscriptionAuditEvent,
  enforceAdminRateLimit,
  isValidCompanyPlan,
  isValidCompanySubscriptionStatus,
  normalizeCompanySubscription,
  parseFutureDateInput,
  requirePlatformSuperAdmin,
} from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  const { id } = await context.params;
  let companyObjectId: ObjectId;
  try {
    companyObjectId = new ObjectId(id);
  } catch {
    return jsonResponse(origin, { ok: false, message: "Invalid company id" }, 400);
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};
  const explicitStatus = body?.subscriptionStatus;

  if (body?.plan !== undefined) {
    if (!isValidCompanyPlan(body.plan)) {
      return jsonResponse(origin, { ok: false, message: "Invalid plan" }, 400);
    }
    patch.plan = body.plan;
    changes.plan = body.plan;
  }

  if (explicitStatus !== undefined) {
    if (!isValidCompanySubscriptionStatus(explicitStatus)) {
      return jsonResponse(origin, { ok: false, message: "Invalid subscriptionStatus" }, 400);
    }
    patch.subscriptionStatus = explicitStatus;
    changes.subscriptionStatus = explicitStatus;
  }

  if (body?.validUntil !== undefined) {
    const validUntil = parseFutureDateInput(body.validUntil);
    if (!validUntil) {
      return jsonResponse(origin, { ok: false, message: "Invalid validUntil" }, 400);
    }
    const suspendedExplicitly = explicitStatus === "suspended";
    if (validUntil.getTime() <= Date.now() && !suspendedExplicitly) {
      return jsonResponse(
        origin,
        { ok: false, message: "validUntil must be in the future unless suspended is set explicitly" },
        400,
      );
    }
    patch.validUntil = validUntil;
    changes.validUntil = validUntil.toISOString();
  }

  if (body?.maxUsers !== undefined) {
    const maxUsers = Number(body.maxUsers);
    if (!Number.isFinite(maxUsers) || maxUsers < 1) {
      return jsonResponse(origin, { ok: false, message: "maxUsers must be >= 1" }, 400);
    }
    patch.maxUsers = Math.floor(maxUsers);
    changes.maxUsers = Math.floor(maxUsers);
  }

  if (body?.notes !== undefined) {
    patch.notes = safeString(body.notes);
    changes.notes = safeString(body.notes);
  }

  if (Object.keys(patch).length === 0) {
    return jsonResponse(origin, { ok: false, message: "No subscription fields provided" }, 400);
  }

  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const existing = await companies.findOne({
      _id: companyObjectId,
      deletedAt: { $exists: false },
    });

    if (!existing) {
      return jsonResponse(origin, { ok: false, message: "Company not found" }, 404);
    }

    const normalizedBefore = normalizeCompanySubscription(existing);
    if (
      patch.validUntil instanceof Date &&
      patch.validUntil.getTime() > Date.now() &&
      normalizedBefore.subscriptionStatus === "suspended" &&
      explicitStatus === undefined
    ) {
      patch.subscriptionStatus = "active";
      changes.subscriptionStatus = "active";
    }

    const auditEntry = buildSubscriptionAuditEvent(session, changes);

    await companies.updateOne(
      { _id: companyObjectId },
      {
        $set: {
          ...patch,
          updatedAt: new Date(),
        },
        $push: {
          subscriptionHistory: auditEntry,
        },
      } as any,
    );

    const updated = await companies.findOne({ _id: companyObjectId });

    return jsonResponse(origin, {
      ok: true,
      data: {
        id,
        subscription: buildCompanySubscriptionResponse(updated),
        notes: safeString(updated?.notes),
      },
    });
  } catch (e: any) {
    console.error("ADMIN COMPANY SUBSCRIPTION PATCH ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
