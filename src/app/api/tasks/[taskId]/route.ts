import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { activeDocumentFilter, buildSoftDeleteFields } from "@/lib/trash";
import {
  ensureTaskIndexes,
  getCompanyMemberById,
  getSessionUserId,
  getSessionUserName,
  isAdminLikeRole,
  jsonResponse,
  normalizeTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
} from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const activeCompanyId = String(session.activeCompanyId);
  const currentUserId = getSessionUserId(session);
  const currentUserName = getSessionUserName(session);
  const isAdmin = isAdminLikeRole(session);
  const body = await req.json().catch(() => ({} as any));

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    const tasks = db.collection("tasks");
    const existing = await tasks.findOne({
      _id: taskObjectId,
      companyId: activeCompanyId,
      ...activeDocumentFilter(),
    });

    if (!existing) {
      return jsonResponse(origin, { ok: false, error: "Task not found" }, 404);
    }

    const isAssignedUser =
      !!currentUserId && safeString(existing.assignedToUserId) === currentUserId;

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
      if ("planningId" in body) setObj.planningId = safeString(body?.planningId) || undefined;
      if ("customerId" in body) setObj.customerId = safeString(body?.customerId) || undefined;
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

      if ("assignedToUserId" in body) {
        const assignedToUserId = safeString(body?.assignedToUserId);

        if (!assignedToUserId) {
          setObj.assignedToUserId = undefined;
          setObj.assignedToName = safeString(body?.assignedToName);
          setObj.assignedToEmail = safeString(body?.assignedToEmail);
        } else {
          const assignedUser = await getCompanyMemberById(
            db,
            activeCompanyId,
            assignedToUserId
          );

          if (!assignedUser) {
            return jsonResponse(
              origin,
              { ok: false, error: "Assigned user is not an active company member" },
              400
            );
          }

          setObj.assignedToUserId = assignedUser._id.toString();
          setObj.assignedToName =
            [safeString(assignedUser.firstName), safeString(assignedUser.lastName)]
              .filter(Boolean)
              .join(" ") ||
            safeString(assignedUser.name) ||
            safeString(assignedUser.email);
          setObj.assignedToEmail = safeString(assignedUser.email);
        }
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
      { _id: taskObjectId, companyId: activeCompanyId, ...activeDocumentFilter() },
      { $set: setObj }
    );

    const updated = await tasks.findOne({
      _id: taskObjectId,
      companyId: activeCompanyId,
      ...activeDocumentFilter(),
    });

    return jsonResponse(origin, { ok: true, task: normalizeTask(updated) }, 200);
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

  const { taskId } = await params;
  const taskObjectId = toObjectIdOrNull(taskId);
  if (!taskObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    const result = await db.collection("tasks").updateOne(
      {
        _id: taskObjectId,
        companyId: String(session.activeCompanyId),
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
