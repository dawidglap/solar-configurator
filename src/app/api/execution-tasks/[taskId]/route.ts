import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { activeDocumentFilter } from "@/lib/trash";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  jsonResponse,
  noStoreHeaders,
  getSessionUserId,
} from "@/lib/tasks";
import { readSession, safeString } from "@/lib/api-session";
import { buildIdVariants } from "@/lib/tasks";
import {
  buildExecutionScheduleHistoryEntry,
  ensureExecutionTaskIndexes,
  getExecutionTasksCollection,
  hasExecutionScheduleChanged,
  hydrateExecutionTasks,
  normalizeExecutionAddress,
  normalizeExecutionDate,
  normalizeExecutionStage,
  normalizeExecutionTime,
  validateExecutionAssignees,
} from "@/lib/executionTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string }> };

function buildExecutionCompanyFilter(companyId: string) {
  return { companyId: { $in: buildIdVariants(companyId) } };
}

async function getScopedExecutionTask(
  db: Awaited<ReturnType<typeof getDb>>,
  companyId: string,
  taskId: string,
) {
  return getExecutionTasksCollection(db).findOne({
    _id: new ObjectId(taskId),
    ...buildExecutionCompanyFilter(companyId),
  });
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
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureExecutionTaskIndexes(db);

    const doc = await getScopedExecutionTask(db, String(session.activeCompanyId), taskId);
    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found" }, 404);
    }

    const [item] = await hydrateExecutionTasks(db, String(session.activeCompanyId), [doc]);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION TASK ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const companyId = String(session.activeCompanyId);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureExecutionTaskIndexes(db);

    const existing = await getScopedExecutionTask(db, companyId, taskId);
    if (!existing) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found" }, 404);
    }

    const nextStage =
      body?.stage === undefined ? null : normalizeExecutionStage(body?.stage);
    if (body?.stage !== undefined && !nextStage) {
      return jsonResponse(origin, { ok: false, error: "Invalid stage" }, 400);
    }

    const scheduledStart =
      body?.scheduledStart === undefined
        ? undefined
        : normalizeExecutionDate(body?.scheduledStart);
    const scheduledEnd =
      body?.scheduledEnd === undefined
        ? undefined
        : normalizeExecutionDate(body?.scheduledEnd);
    const startTime =
      body?.startTime === undefined ? undefined : normalizeExecutionTime(body?.startTime);
    const endTime =
      body?.endTime === undefined ? undefined : normalizeExecutionTime(body?.endTime);

    if (scheduledStart === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid scheduledStart" }, 400);
    }
    if (scheduledEnd === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid scheduledEnd" }, 400);
    }
    if (startTime === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid startTime" }, 400);
    }
    if (endTime === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid endTime" }, 400);
    }

    const updateSet: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (body?.notes !== undefined) {
      updateSet.notes = safeString(body?.notes);
    }
    if (body?.address !== undefined) {
      updateSet.address = normalizeExecutionAddress({
        ...(existing as any)?.address,
        ...(body?.address ?? {}),
      });
    }
    if (scheduledStart !== undefined) {
      updateSet.scheduledStart = scheduledStart;
    }
    if (scheduledEnd !== undefined) {
      updateSet.scheduledEnd = scheduledEnd;
    }
    if (startTime !== undefined) {
      updateSet.startTime = startTime;
    }
    if (endTime !== undefined) {
      updateSet.endTime = endTime;
    }

    if (body?.assignedUserIds !== undefined) {
      const { assignedUserIds } = await validateExecutionAssignees(
        db,
        companyId,
        (existing as any).track,
        body?.assignedUserIds,
      );
      updateSet.assignedUserIds = assignedUserIds;
    }

    const scheduleChanged = hasExecutionScheduleChanged(existing, {
      scheduledStart,
      scheduledEnd,
      startTime,
      endTime,
    });
    const scheduleHistoryEntry = scheduleChanged
      ? buildExecutionScheduleHistoryEntry(existing, session, body?.rescheduleReason)
      : null;

    let pushStageHistory: Record<string, any> | null = null;
    if (nextStage && nextStage !== (existing as any)?.stage) {
      updateSet.stage = nextStage;
      pushStageHistory = {
        stage: nextStage,
        at: new Date().toISOString(),
        by: getSessionUserId(session) || null,
      };
    }

    await getExecutionTasksCollection(db).updateOne(
      { _id: new ObjectId(taskId), ...buildExecutionCompanyFilter(companyId) },
      {
        $set: updateSet,
        ...((pushStageHistory || scheduleHistoryEntry)
          ? {
              $push: {
                ...(pushStageHistory ? { stageHistory: pushStageHistory } : {}),
                ...(scheduleHistoryEntry ? { scheduleHistory: scheduleHistoryEntry } : {}),
              },
            }
          : {}),
      } as any,
    );

    const updated = await getScopedExecutionTask(db, companyId, taskId);
    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found after update" }, 404);
    }

    const [item] = await hydrateExecutionTasks(db, companyId, [updated]);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("PATCH EXECUTION TASK ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}
