import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  ensureTaskIndexes,
  getSessionUserEmail,
  getSessionUserId,
  getSessionUserName,
  getTaskPermissions,
  hydrateTaskAssignments,
  isAdminLikeRole,
  isTaskAssignedToUser,
  jsonResponse,
  normalizeTask,
  normalizeTaskPriority,
  sortTasks,
  safeNumber,
  validateAssignedTaskUsers,
} from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const TASKS_DEBUG_VERSION = "tasks-create-2026-05-09-v2";

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

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const activeCompanyId = normalizeActiveCompanyId(session.activeCompanyId);
  const currentUserId = getSessionUserId(session);
  const permissions = getTaskPermissions(session);

  if (!permissions.canViewAll && !currentUserId) {
    return jsonResponse(
      origin,
      { ok: true, items: [], permissions },
      200
    );
  }

  const url = new URL(req.url);
  const planningId = safeString(url.searchParams.get("planningId"));
  const customerId = safeString(url.searchParams.get("customerId"));
  const status = safeString(url.searchParams.get("status")).toLowerCase();
  const assignedToUserId = safeString(url.searchParams.get("assignedToUserId"));
  const q = safeString(url.searchParams.get("q"));
  const limit = Math.min(Math.max(safeNumber(url.searchParams.get("limit"), 200), 1), 500);

  const filter: Record<string, any> = {
    companyId: buildCompanyIdFilter(activeCompanyId),
    ...activeDocumentFilter(),
  };

  if (!permissions.canViewAll) {
    filter.$and = [
      {
        $or: [
          { assignedToUserIds: currentUserId },
          { assignedToUserId: currentUserId },
        ],
      },
    ];
  } else if (assignedToUserId) {
    filter.$and = [
      {
        $or: [
          { assignedToUserIds: assignedToUserId },
          { assignedToUserId },
        ],
      },
    ];
  }

  if (planningId) filter.planningId = planningId;
  if (customerId) filter.customerId = customerId;
  if (status) filter.status = status;
  if (q) {
    const searchFilter = {
      $or: [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { assignedToName: { $regex: q, $options: "i" } },
        { assignedToEmail: { $regex: q, $options: "i" } },
      ],
    };
    if (Array.isArray(filter.$and)) {
      filter.$and.push(searchFilter);
    } else {
      filter.$or = searchFilter.$or;
    }
  }

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);
    const tasks = db.collection("tasks");
    console.log("[tasks.list] request", {
      method: req.method,
      url: req.url,
      userId: currentUserId,
      companyId: activeCompanyId,
      db: db.databaseName,
      collection: tasks.collectionName,
      filter,
      debugVersion: TASKS_DEBUG_VERSION,
    });

    const docs = await tasks.find(filter).limit(limit * 3).toArray();
    const hydratedDocs = await hydrateTaskAssignments(db, activeCompanyId, docs);
    const items = sortTasks(hydratedDocs.map((doc) => normalizeTask(doc))).slice(0, limit);
    const effectivePermissions = {
      ...permissions,
      canCompleteAssigned:
        permissions.canEditAll ||
        (!!currentUserId && items.some((item) => isTaskAssignedToUser(item, currentUserId))),
    };

    return jsonResponse(origin, { ok: true, items, permissions: effectivePermissions, debugVersion: TASKS_DEBUG_VERSION }, 200);
  } catch (e: any) {
    console.error("GET TASKS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
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

  const activeCompanyId = normalizeActiveCompanyId(session.activeCompanyId);
  const createdByUserId = getSessionUserId(session);
  const createdByName = getSessionUserName(session);
  const createdByEmail = getSessionUserEmail(session);
  const body = await req.json().catch(() => ({} as any));
  console.log("[tasks.create] request", { method: req.method, url: req.url, debugVersion: TASKS_DEBUG_VERSION });
  console.log("[tasks.create] session", { userId: createdByUserId, companyId: activeCompanyId });
  console.log("[tasks.create] payload", body);

  const title = safeString(body?.title);
  if (!title) {
    return jsonResponse(origin, { ok: false, error: "title is required" }, 400);
  }

  const priority = normalizeTaskPriority(body?.priority) ?? "medium";

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);
    const tasks = db.collection("tasks");
    console.log("[tasks.create] target", {
      db: db.databaseName,
      collection: tasks.collectionName,
      companyIdFilter: buildCompanyIdFilter(activeCompanyId),
    });

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
    const requestedPlanningId = safeString(body?.planningId);
    const requestedCustomerId = safeString(body?.customerId);
    let planningTitle = "";

    if (requestedPlanningId) {
      const planningId = toObjectIdOrNull(requestedPlanningId);
      if (planningId) {
        const planning = await db.collection("plannings").findOne(
          {
            _id: planningId,
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
        planningTitle =
          safeString(planning?.title) ||
          safeString((planning as any)?.summary?.customerName) ||
          safeString((planning as any)?.planningNumber);
      }
    }

    const now = new Date().toISOString();
    const task = {
      companyId: activeCompanyId,
      ...(requestedPlanningId ? { planningId: requestedPlanningId } : {}),
      ...(planningTitle ? { planningTitle } : {}),
      ...(requestedCustomerId ? { customerId: requestedCustomerId } : {}),
      title,
      description: safeString(body?.description),
      status: "open",
      priority,
      assignedToUserIds: assignment.assignedToUserIds,
      assignedToUserId: assignment.assignedToUserId,
      ...(assignment.assignedToName ? { assignedToName: assignment.assignedToName } : {}),
      ...(assignment.assignedToEmail ? { assignedToEmail: assignment.assignedToEmail } : {}),
      assignedToNames: assignment.assignedToNames,
      createdByUserId,
      createdByName,
      ...(createdByEmail ? { createdByEmail } : {}),
      ...(safeString(body?.dueDate) ? { dueDate: safeString(body?.dueDate) } : {}),
      completedAt: null,
      completedByUserId: null,
      completedByName: null,
      createdAt: now,
      updatedAt: now,
    };
    console.log("[tasks.create] document", task);

    const result = await tasks.insertOne(task);
    console.log("[tasks.create] inserted", result);
    if (!result?.acknowledged || !result?.insertedId) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error: "Task insert was not acknowledged",
          debugVersion: TASKS_DEBUG_VERSION,
        },
        500
      );
    }

    const insertedCount = await tasks.countDocuments({ _id: result.insertedId });
    const saved = await tasks.findOne({
      _id: result.insertedId,
      companyId: buildCompanyIdFilter(activeCompanyId),
    });
    console.log("[tasks.create] readAfterWrite", {
      insertedId: result.insertedId,
      insertedCount,
      saved,
    });

    if (!saved) {
      return jsonResponse(
        origin,
        {
          ok: false,
          message: "Task insert acknowledged but not readable after insert",
          debugVersion: TASKS_DEBUG_VERSION,
        },
        500
      );
    }

    const normalized = normalizeTask(saved);
    return jsonResponse(
      origin,
      {
        ok: true,
        task: normalized,
        item: normalized,
        debugVersion: TASKS_DEBUG_VERSION,
      },
      200
    );
  } catch (e: any) {
    console.error("CREATE TASK ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
