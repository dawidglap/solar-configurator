import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import { backfillExecutionTasksForWonPlannings } from "@/lib/executionTasks";
import {
  isAdminLikeRole,
  jsonResponse,
  noStoreHeaders,
} from "@/lib/tasks";
import { readSession } from "@/lib/api-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }
  if (!isAdminLikeRole(session)) {
    return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const result = await backfillExecutionTasksForWonPlannings(db, session);
    return jsonResponse(origin, { ok: true, ...result }, 200);
  } catch (e: any) {
    console.error("BACKFILL EXECUTION TASKS ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}
