import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { mongoIdToString, readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { activeDocumentFilter, buildSoftDeleteFields } from "@/lib/trash";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  ensureTaskIndexes,
  getSessionUserId,
  getSessionUserName,
  hydrateTaskAssignments,
  isAdminLikeRole,
  isTaskAssignedToUser,
  jsonResponse,
  normalizeTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
  toStoredObjectIdOrString,
  validateAssignedTaskUsers,
} from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeActiveCompanyId(value: unknown) {
  return mongoIdToString(value) || safeString(value);
}

function buildCompanyIdFilter(activeCompanyId: string) {
  const objectId = toObjectIdOrNull(activeCompanyId);
  return objectId ? { $in: [activeCompanyId, objectId] } : activeCompanyId;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(origin),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
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
  const taskObjectId = toObjectIdOrNull(taskId);
  if (!taskObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  const activeCompanyId = normalizeActiveCompanyId(session.activeCompanyId);
  const currentUserId = getSessionUserId(session);
  const currentUserName = getSessionUserName(session);
  const isAdmin = isAdminLikeRole(session);
  const body = await req.json().catch(() => ({} as any));

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTaskIndexes(db);

    const tasks = db.collection("tasks");
    const existing = await tasks.findOne({
      _id: taskObjectId,
      companyId: buildCompanyIdFilter(activeCompanyId),
      ...activeDocumentFilter(),
    });

    if (!existing) {
      return jsonResponse(origin, { ok: false, error: "Task not found" }, 404);
    }

    const isAssignedUser = !!currentUserId && isTaskAssignedToUser(existing, currentUserId);

    if (!isAdmin && !isAssignedUser) {
      return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
    }

    const setObj: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (!isAdmin) {
      const keys = Object.keys(body).filter((key) => key !== "status");
      if (keys.length > 0) {
        return jsonResponse(
          origin,
          { ok: false, error: "Assigned users can only update status" },
          403
        );
      }

      const status = normalizeTaskStatus(body?.status);
      if (!status) {
        return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
      }

      setObj.status = status;
      if (status === "done") {
        setObj.completedAt = new Date().toISOString();
        setObj.completedByUserId = currentUserId || null;
        setObj.completedByName = currentUserName || null;
      } else {
        setObj.completedAt = null;
        setObj.completedByUserId = null;
        setObj.completedByName = null;
      }
    } else {
      if ("title" in body) setObj.title = safeString(body?.title);
      if ("description" in body) setObj.description = safeString(body?.description);
      if ("planningId" in body) {
        const requestedPlanningId = body?.planningId === null ? null : safeString(body?.planningId);
        if (!requestedPlanningId) {
          setObj.planningId = null;
          setObj.planningTitle = null;
        } else {
          const planningObjectId = toObjectIdOrNull(requestedPlanningId);
          if (!planningObjectId) {
            return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
          }
          setObj.planningId = planningObjectId;
          let planningTitle = "";
          const planning = await db.collection("plannings").findOne(
            {
              _id: planningObjectId,
              companyId: buildCompanyIdFilter(activeCompanyId),
              ...activeDocumentFilter(),
            },
            {
              projection: {
                title: 1,
                planningNumber: 1,
                summary: 1,
              },
            },
          );
          if (!planning) {
            return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
          }
          planningTitle =
            safeString(planning?.title) ||
            safeString((planning as any)?.summary?.customerName) ||
            safeString((planning as any)?.planningNumber);
          setObj.planningTitle = planningTitle || null;
        }
      }
      if ("customerId" in body) {
        const requestedCustomerId = body?.customerId === null ? null : safeString(body?.customerId);
        if (!requestedCustomerId) {
          setObj.customerId = null;
        } else {
          const customerObjectId = toObjectIdOrNull(requestedCustomerId);
          if (!customerObjectId) {
            return jsonResponse(origin, { ok: false, error: "Invalid customerId" }, 400);
          }
          setObj.customerId = customerObjectId;
        }
      }
      if ("dueDate" in body) setObj.dueDate = safeString(body?.dueDate) || undefined;

      if ("priority" in body) {
        const priority = normalizeTaskPriority(body?.priority);
        if (!priority) {
          return jsonResponse(origin, { ok: false, error: "Invalid priority" }, 400);
        }
        setObj.priority = priority;
      }

      if ("status" in body) {
        const status = normalizeTaskStatus(body?.status);
        if (!status) {
          return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
        }
        setObj.status = status;

        if (status === "done") {
          setObj.completedAt = new Date().toISOString();
          setObj.completedByUserId = currentUserId || null;
          setObj.completedByName = currentUserName || null;
        } else if (safeString(existing.status) === "done") {
          setObj.completedAt = null;
          setObj.completedByUserId = null;
          setObj.completedByName = null;
        }
      }

      if ("assignedToUserIds" in body || "assignedToUserId" in body) {
        const requestedAssignedToUserIds = Array.isArray(body?.assignedToUserIds)
          ? body.assignedToUserIds
          : safeString(body?.assignedToUserId)
            ? [safeString(body?.assignedToUserId)]
            : [];
        const assignment = await validateAssignedTaskUsers(
          db,
          activeCompanyId,
          requestedAssignedToUserIds,
        );
        setObj.assignedToUserIds = assignment.assignedToUserIds.map((value) => toStoredObjectIdOrString(value));
        setObj.assignedToUserId = assignment.assignedToUserId
          ? toStoredObjectIdOrString(assignment.assignedToUserId)
          : null;
        setObj.assignedToName = assignment.assignedToName || null;
        setObj.assignedToEmail = assignment.assignedToEmail || null;
        setObj.assignedToNames = assignment.assignedToNames;
      } else {
        if ("assignedToName" in body) setObj.assignedToName = safeString(body?.assignedToName);
        if ("assignedToEmail" in body) setObj.assignedToEmail = safeString(body?.assignedToEmail);
      }
    }

    Object.keys(setObj).forEach((key) => {
      if (setObj[key] === undefined) {
        delete setObj[key];
      }
    });

    await tasks.updateOne(
      { _id: taskObjectId, companyId: buildCompanyIdFilter(activeCompanyId), ...activeDocumentFilter() },
      { $set: setObj }
    );

    const updated = await tasks.findOne({
      _id: taskObjectId,
      companyId: buildCompanyIdFilter(activeCompanyId),
      ...activeDocumentFilter(),
    });

    const [hydrated] = await hydrateTaskAssignments(db, activeCompanyId, updated ? [updated] : []);
    const normalized = normalizeTask(hydrated);
    return jsonResponse(origin, { ok: true, item: normalized, task: normalized }, 200);
  } catch (e: any) {
    console.error("PATCH TASK ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
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

  const activeCompanyId = normalizeActiveCompanyId(session.activeCompanyId);

  const { taskId } = await params;
  const taskObjectId = toObjectIdOrNull(taskId);
  if (!taskObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTaskIndexes(db);

    const result = await db.collection("tasks").updateOne(
      {
        _id: taskObjectId,
        companyId: buildCompanyIdFilter(activeCompanyId),
        ...activeDocumentFilter(),
      },
      {
        $set: {
          ...buildSoftDeleteFields(session as any),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    if (!result.matchedCount) {
      return jsonResponse(origin, { ok: false, error: "Task not found" }, 404);
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE TASK ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
