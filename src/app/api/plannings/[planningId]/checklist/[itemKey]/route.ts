import { ObjectId } from "mongodb";
import { getDb, getMongoClient } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { jsonResponse as taskJsonResponse, noStoreHeaders } from "@/lib/tasks";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildDefaultChecklist,
  ensurePlanningChecklistMigration,
  normalizePlanningChecklist,
  updateChecklistItem,
} from "@/lib/plannings";
import { CHECKLIST_ITEMS, CHECKLIST_ITEM_MAP, type ChecklistItemKey } from "@/lib/checklistCatalog";
import {
  advanceAuftragSteps,
  buildChecklistFromAuftragState,
  ensureAuftragIndexes,
  getHydratedAuftragState,
  getNextTemplateStepKey,
  getSessionActor,
  isLockedTemplateStep,
  logAuftragAdvance,
  normalizeAuftrag,
  persistAuftragStepsState,
  runWithOptionalTransaction,
} from "@/lib/auftragPipeline";
import { toObjectIdOrNull } from "@/lib/api-session";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

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
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAuftragIndexes(db);
    const checklist = await ensureChecklistOnPlanning(
      db,
      planningId,
      String(session.activeCompanyId),
    );

    if (!checklist) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const planning = await getScopedPlanning(db, planningId, String(session.activeCompanyId));
    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const orderId = safeString((planning as any)?.orderId);
    const companyObjectId = toObjectIdOrNull(String(session.activeCompanyId));
    if (
      safeString((planning as any)?.orderStatus) === "generated" &&
      orderId &&
      companyObjectId
    ) {
      const actor = getSessionActor(session);
      const hydrated = await getHydratedAuftragState({
        db,
        companyId: companyObjectId,
        orderId,
        actor,
      });

      if (!hydrated) {
        return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
      }

      if (isLockedTemplateStep(hydrated.templateSteps, itemKey)) {
        return jsonResponse(
          origin,
          {
            ok: false,
            message: "Gesperrte Pipeline-Schritte werden automatisch vom System gesteuert.",
          },
          409,
        );
      }

      const targetStepKey = body.done
        ? getNextTemplateStepKey(hydrated.templateSteps, itemKey) || itemKey
        : itemKey;
      const client = await getMongoClient();
      const result = await runWithOptionalTransaction(client, async (txnSession) => {
        const advanced = advanceAuftragSteps({
          templateSteps: hydrated.templateSteps,
          existingStepsState: hydrated.stepsState,
          toStepKey: targetStepKey,
          actor,
        });
        const now = new Date();

        await persistAuftragStepsState({
          db,
          companyId: companyObjectId,
          orderId,
          templateSteps: hydrated.templateSteps,
          stepsState: advanced.stepsState,
          session: txnSession,
        });

        await db.collection("auftraege").updateOne(
          {
            _id: (hydrated.auftrag as any)._id,
            companyId: companyObjectId,
          },
          {
            $set: {
              orderId,
              currentStepKey: advanced.currentStepKey,
              status: advanced.status,
              completedAt: advanced.status === "abgeschlossen" ? now : null,
              updatedAt: now,
            },
            $unset: {
              stepsState: "",
            },
          },
          txnSession ? { session: txnSession } : undefined,
        );

        const nextMontageStatus = advanced.status === "abgeschlossen" ? "completed" : "offen";
        const montageId = toObjectIdOrNull((hydrated.auftrag as any)?.montageId);
        if (montageId) {
          await db.collection("montages").updateOne(
            {
              _id: montageId,
              companyId: companyObjectId,
            },
            {
              $set: {
                status: nextMontageStatus,
                updatedAt: now,
              },
            },
            txnSession ? { session: txnSession } : undefined,
          );
        }

        await db.collection("plannings").updateOne(
          {
            _id: (hydrated.auftrag as any).planningId,
            companyId: String(session.activeCompanyId),
          },
          {
            $set: {
              "data.montageStatus": nextMontageStatus,
              updatedAt: now,
            },
          },
          txnSession ? { session: txnSession } : undefined,
        );

        await logAuftragAdvance({
          db,
          companyId: companyObjectId,
          auftragId: (hydrated.auftrag as any)._id,
          actor,
          fromStepKey: safeString((hydrated.auftrag as any)?.currentStepKey),
          toStepKey: advanced.currentStepKey,
          session: txnSession,
        });

        return {
          normalizedAuftrag: normalizeAuftrag({
            ...hydrated.auftrag,
            currentStepKey: advanced.currentStepKey,
            status: advanced.status,
            completedAt: advanced.status === "abgeschlossen" ? now : null,
            updatedAt: now,
          }),
          montageId,
          montageStatus: nextMontageStatus,
          stepsState: advanced.stepsState,
          checklist: buildChecklistFromAuftragState({
            templateSteps: hydrated.templateSteps,
            stepsState: advanced.stepsState,
          }),
        };
      });

      await emitCompanyRealtimeEvent(String(session.activeCompanyId), "orders", {
        orderId,
        currentStepKey: result.normalizedAuftrag.currentStepKey,
        completedAt: result.normalizedAuftrag.completedAt,
        status: result.normalizedAuftrag.status,
      });
      await emitCompanyRealtimeEvent(String(session.activeCompanyId), "auftrag-steps", {
        orderId,
        stepsState: result.stepsState,
      });
      await emitCompanyRealtimeEvent(String(session.activeCompanyId), "planning-checklist", {
        planningId,
        checklist: result.checklist,
      });
      if (result.montageId) {
        await emitCompanyRealtimeEvent(String(session.activeCompanyId), "montage:updated", {
          montageId: safeString((result.montageId as any)?.toString?.() ?? result.montageId),
          status: result.montageStatus,
        });
      }

      return jsonResponse(
        origin,
        {
          ok: true,
          order: {
            orderId,
            currentStepKey: result.normalizedAuftrag.currentStepKey,
            completedAt: result.normalizedAuftrag.completedAt,
            status: result.normalizedAuftrag.status,
          },
          auftragId: result.normalizedAuftrag.id,
          stepsState: result.stepsState,
          checklist: result.checklist,
        },
        200,
      );
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
