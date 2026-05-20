import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import { jsonResponse, noStoreHeaders, buildIdVariants } from "@/lib/tasks";
import { readSession } from "@/lib/api-session";
import {
  canDeleteExecutionActivity,
  ensureExecutionActivityIndexes,
  ensureExecutionTaskIndexes,
  getExecutionActivitiesCollection,
  getExecutionTasksCollection,
} from "@/lib/executionTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string; activityId: string }> };

function buildExecutionCompanyFilter(companyId: string) {
  return { companyId: { $in: buildIdVariants(companyId) } };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { taskId, activityId } = await params;
  if (!ObjectId.isValid(taskId) || !ObjectId.isValid(activityId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid params" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureExecutionTaskIndexes(db), ensureExecutionActivityIndexes(db)]);

    const task = await getExecutionTasksCollection(db).findOne({
      _id: new ObjectId(taskId),
      ...buildExecutionCompanyFilter(String(session.activeCompanyId)),
    });
    if (!task) {
      return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    }

    const activity = await getExecutionActivitiesCollection(db).findOne({
      _id: new ObjectId(activityId),
      taskId: new ObjectId(taskId),
      ...buildExecutionCompanyFilter(String(session.activeCompanyId)),
    });
    if (!activity) {
      return jsonResponse(origin, { ok: false, message: "Activity not found" }, 404);
    }

    if (!canDeleteExecutionActivity(activity, session)) {
      return jsonResponse(origin, { ok: false, message: "Forbidden" }, 403);
    }

    await getExecutionActivitiesCollection(db).deleteOne({
      _id: new ObjectId(activityId),
      taskId: new ObjectId(taskId),
      ...buildExecutionCompanyFilter(String(session.activeCompanyId)),
    });

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE EXECUTION ACTIVITY ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
