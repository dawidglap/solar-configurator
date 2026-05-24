import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  jsonResponse,
  readSession,
  toObjectIdOrNull,
} from "@/lib/api-session";
import {
  assertCompanyScopedPlanning,
  getPlanningsCollection,
  isPlanningMontageReady,
} from "@/lib/montages";
import {
  ensureExecutionTaskIndexes,
  ensureExecutionTasksForWonPlanning,
  getExecutionTasksCollection,
  getPlanningProjectId,
  hydrateExecutionTasks,
} from "@/lib/executionTasks";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId || !session?.userId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  const activeCompanyId = String(session.activeCompanyId);
  const planningObjectId = toObjectIdOrNull(planningId);

  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid request scope" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureExecutionTaskIndexes(db);

    const planning = await assertCompanyScopedPlanning(db, planningId, activeCompanyId);
    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    if (!isPlanningMontageReady(planning)) {
      return jsonResponse(
        origin,
        { ok: false, error: "Planning is not ready for montage" },
        400
      );
    }

    const result = await ensureExecutionTasksForWonPlanning(db, planning, session as any);
    const projectId = getPlanningProjectId(planning);
    const rawTasks =
      result.items.length > 0
        ? result.items
        : await getExecutionTasksCollection(db)
            .find({
              companyId: activeCompanyId,
              projectId,
              track: { $in: ["montage", "elektro"] },
            })
            .toArray();
    const hydratedTasks = await hydrateExecutionTasks(db, activeCompanyId, rawTasks);
    const item = hydratedTasks.find((task) => task.track === "montage");

    if (!item) {
      return jsonResponse(
        origin,
        { ok: false, error: "Failed to create montage execution task" },
        500,
      );
    }

    await getPlanningsCollection(db).updateOne(
      {
        _id: planningObjectId,
        companyId: activeCompanyId,
      },
      {
        $set: {
          "data.montageId": item.id,
          "data.montageStatus": item.stage,
          "data.montageReady": true,
          updatedAt: new Date(),
        },
      }
    );

    return jsonResponse(
      origin,
      { ok: true, existing: result.created === 0, item },
      200
    );
  } catch (e: any) {
    console.error("CREATE MONTAGE FROM PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
