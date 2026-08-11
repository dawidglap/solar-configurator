import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildIdVariants, jsonResponse, noStoreHeaders } from "@/lib/tasks";
import { ensureExecutionTaskIndexes, getExecutionTasksCollection } from "@/lib/executionTasks";
import { findExecutionCrewConflicts } from "@/lib/executionCrew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string }> };

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: noStoreHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) return jsonResponse(origin, { ok: false, message: "Invalid taskId" }, 400);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureExecutionTaskIndexes(db);
    const companyId = String(session.activeCompanyId);
    const task = await getExecutionTasksCollection(db).findOne({
      _id: new ObjectId(taskId),
      companyId: { $in: buildIdVariants(companyId) },
    });
    if (!task) return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    const conflicts = await findExecutionCrewConflicts({ db, companyId, task });
    return jsonResponse(origin, { ok: true, conflicts }, 200);
  } catch (error: any) {
    console.error("VALIDATE EXECUTION CREW ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
