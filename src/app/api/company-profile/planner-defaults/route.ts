import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  resolveCompanyPlannerDefaults,
  validateCompanyPlannerDefaults,
} from "@/lib/planning/companyPlannerDefaults";
import {
  canEditCompanyPlannerDefaults,
  getAuthenticatedCompanyId,
} from "@/lib/planning/companyPlannerPermissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...getCorsHeaders(origin),
    },
  });
}

function authenticate(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { error: "Missing SESSION_SECRET", status: 500 } as const;
  const session = readSession(req, secret);
  const activeCompanyId = getAuthenticatedCompanyId(session);
  if (!session?.userId || !activeCompanyId) {
    return { error: "Not logged in", status: 401 } as const;
  }
  try {
    return { session, companyObjectId: new ObjectId(activeCompanyId) } as const;
  } catch {
    return { error: "Invalid active company", status: 401 } as const;
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const auth = authenticate(req);
  if ("error" in auth) {
    return response(origin, { ok: false, error: auth.error }, auth.status);
  }
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(
      db,
      origin,
      auth.session,
    );
    if (subscriptionError) return subscriptionError;
    const company = await db.collection("companies").findOne(
      { _id: auth.companyObjectId, deletedAt: { $exists: false } },
      { projection: { plannerDefaults: 1 } },
    );
    if (!company) {
      return response(origin, { ok: false, error: "Company not found" }, 404);
    }
    return response(origin, {
      ok: true,
      plannerDefaults: resolveCompanyPlannerDefaults(company.plannerDefaults),
      configured: validateCompanyPlannerDefaults(company.plannerDefaults).valid,
      canEdit: canEditCompanyPlannerDefaults(auth.session),
    });
  } catch (error: unknown) {
    console.error("GET COMPANY PLANNER DEFAULTS ERROR:", error);
    return response(
      origin,
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");
  const auth = authenticate(req);
  if ("error" in auth) {
    return response(origin, { ok: false, error: auth.error }, auth.status);
  }
  if (!canEditCompanyPlannerDefaults(auth.session)) {
    return response(origin, { ok: false, error: "Forbidden" }, 403);
  }
  const body = await req.json().catch(() => null);
  const validation = validateCompanyPlannerDefaults(body?.plannerDefaults);
  if (!validation.valid) {
    return response(
      origin,
      { ok: false, error: "Invalid planner defaults", details: validation.errors },
      400,
    );
  }
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(
      db,
      origin,
      auth.session,
    );
    if (subscriptionError) return subscriptionError;
    const result = await db.collection("companies").updateOne(
      { _id: auth.companyObjectId, deletedAt: { $exists: false } },
      {
        $set: {
          plannerDefaults: validation.value,
          updatedAt: new Date(),
        },
      },
    );
    if (!result.matchedCount) {
      return response(origin, { ok: false, error: "Company not found" }, 404);
    }
    return response(origin, {
      ok: true,
      plannerDefaults: validation.value,
      configured: true,
      canEdit: true,
    });
  } catch (error: unknown) {
    console.error("PATCH COMPANY PLANNER DEFAULTS ERROR:", error);
    return response(
      origin,
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
