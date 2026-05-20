import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import { jsonResponse, noStoreHeaders, buildIdVariants, getSessionUserId, getSessionUserName } from "@/lib/tasks";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import {
  ensureExecutionActivityIndexes,
  ensureExecutionTaskIndexes,
  getExecutionActivitiesCollection,
  getExecutionTasksCollection,
  normalizeExecutionActivity,
} from "@/lib/executionTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string }> };

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

async function getScopedExecutionTask(db: Awaited<ReturnType<typeof getDb>>, companyId: string, taskId: string) {
  return getExecutionTasksCollection(db).findOne({
    _id: new ObjectId(taskId),
    ...buildExecutionCompanyFilter(companyId),
  });
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid taskId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureExecutionTaskIndexes(db), ensureExecutionActivityIndexes(db)]);

    const task = await getScopedExecutionTask(db, String(session.activeCompanyId), taskId);
    if (!task) {
      return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    }

    const items = (
      await getExecutionActivitiesCollection(db)
        .find({
          taskId: new ObjectId(taskId),
          ...buildExecutionCompanyFilter(String(session.activeCompanyId)),
        })
        .sort({ createdAt: -1, _id: -1 })
        .toArray()
    ).map((doc) => normalizeExecutionActivity(doc));

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION ACTIVITIES ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid taskId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const text = safeString(body?.text).slice(0, 4000);
  if (!text) {
    return jsonResponse(origin, { ok: false, message: "text is required" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureExecutionTaskIndexes(db), ensureExecutionActivityIndexes(db)]);

    const task = await getScopedExecutionTask(db, String(session.activeCompanyId), taskId);
    if (!task) {
      return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    }

    const createdByUserId = getSessionUserId(session);
    const createdByObjectId = toObjectIdOrNull(createdByUserId);
    const doc = {
      taskId: new ObjectId(taskId),
      companyId: (task as any).companyId,
      text,
      createdByUserId: createdByObjectId || createdByUserId || null,
      createdByName: getSessionUserName(session) || "unknown",
      createdAt: new Date(),
    };

    const result = await getExecutionActivitiesCollection(db).insertOne(doc);
    return jsonResponse(
      origin,
      { ok: true, item: normalizeExecutionActivity({ ...doc, _id: result.insertedId }) },
      200,
    );
  } catch (e: any) {
    console.error("CREATE EXECUTION ACTIVITY ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
