import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  readSession,
  safeString,
} from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  ensureTaskIndexes,
  getCompanyMemberById,
  getSessionUserEmail,
  getSessionUserId,
  getSessionUserName,
  getTaskPermissions,
  isAdminLikeRole,
  jsonResponse,
  normalizeTask,
  normalizeTaskPriority,
  sortTasks,
  safeNumber,
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

  const activeCompanyId = String(session.activeCompanyId);
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
    companyId: activeCompanyId,
    ...activeDocumentFilter(),
  };

  if (!permissions.canViewAll) {
    filter.assignedToUserId = currentUserId;
  } else if (assignedToUserId) {
    filter.assignedToUserId = assignedToUserId;
  }

  if (planningId) filter.planningId = planningId;
  if (customerId) filter.customerId = customerId;
  if (status) filter.status = status;
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
      { assignedToName: { $regex: q, $options: "i" } },
      { assignedToEmail: { $regex: q, $options: "i" } },
    ];
  }

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    const docs = await db.collection("tasks").find(filter).limit(limit * 3).toArray();
    const items = sortTasks(docs.map((doc) => normalizeTask(doc))).slice(0, limit);

    return jsonResponse(origin, { ok: true, items, permissions }, 200);
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

  const activeCompanyId = String(session.activeCompanyId);
  const createdByUserId = getSessionUserId(session);
  const createdByName = getSessionUserName(session);
  const createdByEmail = getSessionUserEmail(session);
  const body = await req.json().catch(() => ({} as any));

  const title = safeString(body?.title);
  if (!title) {
    return jsonResponse(origin, { ok: false, error: "title is required" }, 400);
  }

  const priority = normalizeTaskPriority(body?.priority) ?? "medium";

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    let assignedToUserId = safeString(body?.assignedToUserId);
    let assignedToName = safeString(body?.assignedToName);
    let assignedToEmail = safeString(body?.assignedToEmail);

    if (assignedToUserId) {
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

      assignedToUserId = safeString(assignedUser._id?.toString());
      assignedToName =
        [safeString(assignedUser.firstName), safeString(assignedUser.lastName)]
          .filter(Boolean)
          .join(" ") ||
        safeString(assignedUser.name) ||
        safeString(assignedUser.email);
      assignedToEmail = safeString(assignedUser.email);
    }

    const now = new Date().toISOString();
    const task = {
      companyId: activeCompanyId,
      ...(safeString(body?.planningId) ? { planningId: safeString(body?.planningId) } : {}),
      ...(safeString(body?.customerId) ? { customerId: safeString(body?.customerId) } : {}),
      title,
      description: safeString(body?.description),
      status: "open",
      priority,
      ...(assignedToUserId ? { assignedToUserId } : {}),
      ...(assignedToName ? { assignedToName } : {}),
      ...(assignedToEmail ? { assignedToEmail } : {}),
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

    const result = await db.collection("tasks").insertOne(task);
    return jsonResponse(
      origin,
      { ok: true, task: normalizeTask({ ...task, _id: result.insertedId }) },
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
