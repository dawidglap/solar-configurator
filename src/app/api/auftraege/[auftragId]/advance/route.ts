import { getDb, getMongoClient } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  jsonResponse,
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  advanceAuftragSteps,
  buildChecklistFromAuftragState,
  ensureAuftragIndexes,
  getAuftragByOrderId,
  getHydratedAuftragState,
  getSessionActor,
  normalizeAuftrag,
  persistAuftragStepsState,
  logAuftragAdvance,
  runWithOptionalTransaction,
} from "@/lib/auftragPipeline";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ auftragId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const companyObjectId = toObjectIdOrNull(session.activeCompanyId);
  const { auftragId } = await params;
  const orderId = safeString(auftragId);
  if (!companyObjectId || !orderId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  }

  const body = await req.json().catch(() => null);
  const toStepKey = safeString(body?.toStepKey);
  if (!toStepKey) {
    return jsonResponse(origin, { ok: false, message: "toStepKey ist erforderlich." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAuftragIndexes(db);

    const hydrated = await getHydratedAuftragState({
      db,
      companyId: companyObjectId,
      orderId,
      actor: getSessionActor(session),
    });
    if (!hydrated) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }
    const existingAuftrag = hydrated.auftrag;
    if (safeString((existingAuftrag as any)?.status) === "storniert") {
      return jsonResponse(origin, { ok: false, message: "Stornierte Aufträge können nicht verschoben werden." }, 409);
    }

    const client = await getMongoClient();
    const actor = getSessionActor(session);
    const result = await runWithOptionalTransaction(client, async (txnSession) => {
      const advanced = advanceAuftragSteps({
        templateSteps: hydrated.templateSteps,
        existingStepsState: hydrated.stepsState,
        toStepKey,
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
          _id: (existingAuftrag as any)._id,
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
      const montageId = toObjectIdOrNull((existingAuftrag as any)?.montageId);
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
          _id: (existingAuftrag as any).planningId,
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
        auftragId: (existingAuftrag as any)._id,
        actor,
        fromStepKey: safeString((existingAuftrag as any)?.currentStepKey),
        toStepKey: advanced.currentStepKey,
        session: txnSession,
      });

      const updated = await getAuftragByOrderId(db, companyObjectId, orderId, txnSession);
      const checklist = buildChecklistFromAuftragState({
        templateSteps: hydrated.templateSteps,
        stepsState: advanced.stepsState,
      });

      return {
        auftrag: updated,
        montageId,
        montageStatus: nextMontageStatus,
        stepsState: advanced.stepsState,
        checklist,
      };
    });

    const normalized = {
      ...normalizeAuftrag(result.auftrag),
      stepsState: result.stepsState,
    };
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "auftrag:updated", {
      auftragId: normalized.id,
      currentStepKey: normalized.currentStepKey,
      status: normalized.status,
    });
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "orders", {
      orderId: normalized.orderId,
      currentStepKey: normalized.currentStepKey,
      completedAt: normalized.completedAt,
      status: normalized.status,
    });
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "auftrag-steps", {
      orderId: normalized.orderId,
      stepsState: result.stepsState,
    });
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "planning-checklist", {
      planningId: mongoIdToString((result.auftrag as any)?.planningId),
      checklist: result.checklist,
    });
    if (result.montageId) {
      await emitCompanyRealtimeEvent(String(session.activeCompanyId), "montage:updated", {
        montageId: mongoIdToString(result.montageId),
        status: result.montageStatus,
      });
    }

    return jsonResponse(
      origin,
      {
        ok: true,
        order: {
          orderId: normalized.orderId,
          currentStepKey: normalized.currentStepKey,
          completedAt: normalized.completedAt,
          status: normalized.status,
        },
        auftragId: normalized.id,
        orderId: normalized.orderId,
        currentStepKey: normalized.currentStepKey,
        stepsState: result.stepsState,
        checklist: result.checklist,
        status: normalized.status,
      },
      200,
    );
  } catch (error: any) {
    console.error("PATCH AUFTRAG ADVANCE ERROR:", error);
    const status = String(error?.message || "").includes("Zielschritt") ? 400 : 500;
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, status);
  }
}
