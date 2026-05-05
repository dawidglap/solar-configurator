import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { jsonResponse as taskJsonResponse, noStoreHeaders } from "@/lib/tasks";
import {
  applyChecklistBulk,
  buildDefaultChecklist,
  ensurePlanningChecklistMigration,
  normalizePlanningChecklist,
} from "@/lib/plannings";
import { CHECKLIST_ITEMS } from "@/lib/checklistCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string }> };

function jsonResponse(origin: string | null, body: any, status = 200) {
  return taskJsonResponse(origin, body, status);
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
      return !rawItems.some((item: any) => safeString(item?.key) === catalogItem.key);
    });

  if (!needsInit) {
    return {
      planning,
      checklist: normalizePlanningChecklist((planning as any)?.checklist),
    };
  }

  const normalizedChecklist = normalizePlanningChecklist(
    (planning as any)?.checklist ?? buildDefaultChecklist((planning as any)?.createdAt),
  );

  const now = new Date();
  await db.collection("plannings").updateOne(
    {
      _id: new ObjectId(planningId),
      companyId,
      ...activeDocumentFilter(),
    },
    {
      $set: {
        checklist: normalizedChecklist,
        updatedAt: now,
      },
    },
  );

  const refreshed = await getScopedPlanning(db, planningId, companyId);
  if (!refreshed) return null;

  return {
    planning: refreshed,
    checklist: normalizePlanningChecklist((refreshed as any)?.checklist),
  };
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

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  try {
    const db = await getDb();
    const resolved = await ensureChecklistOnPlanning(
      db,
      planningId,
      String(session.activeCompanyId),
    );

    if (!resolved?.planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    return jsonResponse(origin, { ok: true, checklist: resolved.checklist }, 200);
  } catch (e: any) {
    console.error("GET PLANNING CHECKLIST ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) {
    return jsonResponse(origin, { ok: false, message: "items array is required" }, 400);
  }

  try {
    const db = await getDb();
    const resolved = await ensureChecklistOnPlanning(
      db,
      planningId,
      String(session.activeCompanyId),
    );

    if (!resolved?.planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const checklist = applyChecklistBulk(
      resolved.checklist,
      items.map((item: any) => ({
        key: safeString(item?.key),
        done: !!item?.done,
      })),
      session as any,
    );

    await db.collection("plannings").updateOne(
      {
        _id: new ObjectId(planningId),
        companyId: String(session.activeCompanyId),
        ...activeDocumentFilter(),
      },
      {
        $set: {
          checklist,
          updatedAt: new Date(),
        },
      },
    );

    return jsonResponse(origin, { ok: true, checklist }, 200);
  } catch (e: any) {
    console.error("PUT PLANNING CHECKLIST ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
