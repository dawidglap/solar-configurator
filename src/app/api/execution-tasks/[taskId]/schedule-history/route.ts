import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import { jsonResponse, noStoreHeaders, buildIdVariants } from "@/lib/tasks";
import { readSession } from "@/lib/api-session";
import {
  ensureExecutionTaskIndexes,
  getExecutionTasksCollection,
  normalizeExecutionScheduleHistory,
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
    await ensureExecutionTaskIndexes(db);

    const task = await getExecutionTasksCollection(db).findOne({
      _id: new ObjectId(taskId),
      ...buildExecutionCompanyFilter(String(session.activeCompanyId)),
    });

    if (!task) {
      return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    }

    const items = normalizeExecutionScheduleHistory((task as any)?.scheduleHistory).sort((a, b) =>
      b.changedAt.localeCompare(a.changedAt),
    );

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION TASK SCHEDULE HISTORY ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
