import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  jsonResponse,
  noStoreHeaders,
} from "@/lib/tasks";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  ensureExecutionTaskIndexes,
  getExecutionTasksCollection,
  hydrateExecutionTasks,
  normalizeExecutionDate,
  normalizeExecutionStage,
  normalizeExecutionTrack,
} from "@/lib/executionTasks";
import { buildIdVariants } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const companyId = String(session.activeCompanyId);
  const url = new URL(req.url);
  const track = normalizeExecutionTrack(url.searchParams.get("track"));
  const stage = normalizeExecutionStage(url.searchParams.get("stage"));
  const from = normalizeExecutionDate(url.searchParams.get("from"));
  const to = normalizeExecutionDate(url.searchParams.get("to"));
  const q = safeString(url.searchParams.get("q"));
  const assignee = safeString(url.searchParams.get("assignee"));

  if (url.searchParams.get("track") && !track) {
    return jsonResponse(origin, { ok: false, error: "Invalid track" }, 400);
  }
  if (url.searchParams.get("stage") && !stage) {
    return jsonResponse(origin, { ok: false, error: "Invalid stage" }, 400);
  }
  if (url.searchParams.get("from") && from === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid from date" }, 400);
  }
  if (url.searchParams.get("to") && to === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid to date" }, 400);
  }

  const filter: Record<string, any> = {
    ...buildExecutionCompanyFilter(companyId),
  };

  if (track) filter.track = track;
  if (stage) filter.stage = stage;
  if (assignee) {
    if (!ObjectId.isValid(assignee)) {
      return jsonResponse(origin, { ok: false, error: "Invalid assignee" }, 400);
    }
    const assigneeObjectId = new ObjectId(assignee);
    filter.assignedUserIds = assigneeObjectId;
  }
  if (from || to) {
    if (from) {
      filter.$or = filter.$or ?? [];
      filter.$or.push({ scheduledEnd: { $gte: from } }, { scheduledStart: { $gte: from } });
    }
    if (to) {
      filter.$and = filter.$and ?? [];
      filter.$and.push({
        $or: [{ scheduledStart: null }, { scheduledStart: { $lte: to } }],
      });
    }
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureExecutionTaskIndexes(db);

    let docs = await getExecutionTasksCollection(db)
      .find(filter)
      .sort({ scheduledStart: 1, createdAt: -1 })
      .toArray();

    if (q) {
      const hydratedForSearch = await hydrateExecutionTasks(db, companyId, docs);
      const lowered = q.toLowerCase();
      const filtered = hydratedForSearch.filter((item) => {
        return [
          item.customerName,
          item.projectNumber,
          item.planningTitle,
          item.address.street,
          item.address.city,
          item.notes,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(lowered));
      });
      return jsonResponse(origin, { ok: true, items: filtered }, 200);
    }
    const items = await hydrateExecutionTasks(db, companyId, docs);
    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION TASKS ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");
  return jsonResponse(
    origin,
    { ok: false, error: "PATCH requires /api/execution-tasks/:id" },
    405,
  );
}
