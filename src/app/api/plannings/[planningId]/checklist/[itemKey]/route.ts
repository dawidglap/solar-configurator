import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { jsonResponse as taskJsonResponse, noStoreHeaders } from "@/lib/tasks";
import {
  buildDefaultChecklist,
  ensurePlanningChecklistMigration,
  normalizePlanningChecklist,
  updateChecklistItem,
} from "@/lib/plannings";
import { CHECKLIST_ITEMS, CHECKLIST_ITEM_MAP, type ChecklistItemKey } from "@/lib/checklistCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string; itemKey: string }> };

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

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId, itemKey: rawItemKey } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  const itemKey = safeString(rawItemKey) as ChecklistItemKey;
  if (!CHECKLIST_ITEM_MAP.has(itemKey)) {
    return jsonResponse(origin, { ok: false, message: "Invalid itemKey" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  if (typeof body?.done !== "boolean") {
    return jsonResponse(origin, { ok: false, message: "done must be a boolean" }, 400);
  }

  try {
    const db = await getDb();
    const checklist = await ensureChecklistOnPlanning(
      db,
      planningId,
      String(session.activeCompanyId),
    );

    if (!checklist) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const next = updateChecklistItem(
      checklist,
      itemKey,
      {
        done: body.done,
        ...(Object.prototype.hasOwnProperty.call(body, "note")
          ? { note: body.note }
          : {}),
      },
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
          checklist: next.checklist,
          updatedAt: new Date(),
        },
        $push: {
          checklistHistory: next.event,
        },
      } as any,
    );

    return jsonResponse(origin, { ok: true, checklist: next.checklist, event: next.event }, 200);
  } catch (e: any) {
    console.error("PATCH PLANNING CHECKLIST ITEM ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
