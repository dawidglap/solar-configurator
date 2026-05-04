import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, toObjectIdOrNull, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  ensureTaskIndexes,
  getSessionUserId,
  getSessionUserName,
  isAdminLikeRole,
  jsonResponse,
  normalizeTask,
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

export async function POST(
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

  const currentUserId = getSessionUserId(session);
  const currentUserName = getSessionUserName(session);
  const isAdmin = isAdminLikeRole(session);

  try {
    const db = await getDb();
    await ensureTaskIndexes(db);

    const tasks = db.collection("tasks");
    const existing = await tasks.findOne({
      _id: taskObjectId,
      companyId: String(session.activeCompanyId),
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

    const completedAt = new Date().toISOString();
    await tasks.updateOne(
      {
        _id: taskObjectId,
        companyId: String(session.activeCompanyId),
        ...activeDocumentFilter(),
      },
      {
        $set: {
          status: "done",
          completedAt,
          completedByUserId: currentUserId || null,
          completedByName: currentUserName || null,
          updatedAt: completedAt,
        },
      }
    );

    const updated = await tasks.findOne({
      _id: taskObjectId,
      companyId: String(session.activeCompanyId),
      ...activeDocumentFilter(),
    });

    return jsonResponse(origin, { ok: true, task: normalizeTask(updated) }, 200);
  } catch (e: any) {
    console.error("COMPLETE TASK ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
