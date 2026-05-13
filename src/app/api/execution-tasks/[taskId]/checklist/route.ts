import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { enforceActiveSubscription } from "@/lib/subscription";
import { jsonResponse, noStoreHeaders } from "@/lib/tasks";
import {
  buildDefaultChecklist,
  ensurePlanningChecklistMigration,
  normalizePlanningChecklist,
} from "@/lib/plannings";
import { CHECKLIST_ITEMS } from "@/lib/checklistCatalog";
import { buildIdVariants } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string }> };

async function getScopedExecutionTask(db: Awaited<ReturnType<typeof getDb>>, companyId: string, taskId: string) {
  return db.collection("executionTasks").findOne({
    _id: new ObjectId(taskId),
    companyId: { $in: buildIdVariants(companyId) },
  });
}

async function getScopedPlanning(db: Awaited<ReturnType<typeof getDb>>, planningId: string, companyId: string) {
  return db.collection("plannings").findOne({
    _id: new ObjectId(planningId),
    companyId,
    ...activeDocumentFilter(),
  });
}

async function ensureChecklistOnPlanning(
  db: Awaited<ReturnType<typeof getDb>>,
  planningId: string,
  companyId: string,
) {
  await ensurePlanningChecklistMigration(db);
  const planning = await getScopedPlanning(db, planningId, companyId);
  if (!planning) return null;

  const rawItems = Array.isArray((planning as any)?.checklist?.items)
    ? (planning as any).checklist.items
    : [];
  const needsInit =
    !(planning as any)?.checklist ||
    rawItems.length !== CHECKLIST_ITEMS.length ||
    CHECKLIST_ITEMS.some((catalogItem) => {
      return !rawItems.some((item: any) => String(item?.key || "") === catalogItem.key);
    });

  if (!needsInit) {
    return normalizePlanningChecklist((planning as any)?.checklist);
  }

  const checklist = normalizePlanningChecklist(
    (planning as any)?.checklist ?? buildDefaultChecklist((planning as any)?.createdAt),
  );
  await db.collection("plannings").updateOne(
    {
      _id: new ObjectId(planningId),
      companyId,
      ...activeDocumentFilter(),
    },
    {
      $set: {
        checklist,
        updatedAt: new Date(),
      },
    },
  );

  return checklist;
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

    const executionTask = await getScopedExecutionTask(db, String(session.activeCompanyId), taskId);
    if (!executionTask) {
      return jsonResponse(origin, { ok: false, message: "Execution task not found" }, 404);
    }

    const planningId = String((executionTask as any).planningId || "");
    if (!ObjectId.isValid(planningId)) {
      return jsonResponse(origin, { ok: false, message: "Execution task has no valid planningId" }, 400);
    }

    const checklist = await ensureChecklistOnPlanning(
      db,
      planningId,
      String(session.activeCompanyId),
    );
    if (!checklist) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    return jsonResponse(origin, { ok: true, checklist }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION TASK CHECKLIST ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
