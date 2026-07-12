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
  ensureAuftragIndexes,
  ensureCompanyAuftragPipelineTemplate,
  getAuftraegeCollection,
  getSessionActor,
  logAuftragAdvance,
  normalizeAuftrag,
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
  const auftragObjectId = toObjectIdOrNull(auftragId);
  if (!companyObjectId || !auftragObjectId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Anfrage." }, 400);
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

    const existingAuftrag = await getAuftraegeCollection(db).findOne({
      _id: auftragObjectId,
      companyId: companyObjectId,
    });
    if (!existingAuftrag) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }
    if (safeString((existingAuftrag as any)?.status) === "storniert") {
      return jsonResponse(origin, { ok: false, message: "Stornierte Aufträge können nicht verschoben werden." }, 409);
    }

    const client = await getMongoClient();
    const actor = getSessionActor(session);
    const result = await runWithOptionalTransaction(client, async (txnSession) => {
      const template = await ensureCompanyAuftragPipelineTemplate(db, companyObjectId, actor);
      const templateSteps = (template as any)?.steps ?? [];
      const advanced = advanceAuftragSteps({
        templateSteps,
        existingStepsState: (existingAuftrag as any)?.stepsState,
        toStepKey,
        actor,
      });

      const now = new Date();
      await getAuftraegeCollection(db).updateOne(
        {
          _id: auftragObjectId,
          companyId: companyObjectId,
        },
        {
          $set: {
            currentStepKey: advanced.currentStepKey,
            status: advanced.status,
            stepsState: advanced.stepsState,
            updatedAt: now,
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
        auftragId: auftragObjectId,
        actor,
        fromStepKey: safeString((existingAuftrag as any)?.currentStepKey),
        toStepKey: advanced.currentStepKey,
        session: txnSession,
      });

      const updated = await getAuftraegeCollection(db).findOne(
        {
          _id: auftragObjectId,
          companyId: companyObjectId,
        },
        txnSession ? { session: txnSession } : undefined,
      );

      return {
        auftrag: updated,
        montageId,
        montageStatus: nextMontageStatus,
      };
    });

    const normalized = normalizeAuftrag(result.auftrag);
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "auftrag:updated", {
      auftragId: normalized.id,
      currentStepKey: normalized.currentStepKey,
      status: normalized.status,
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
        auftragId: normalized.id,
        currentStepKey: normalized.currentStepKey,
        stepsState: normalized.stepsState,
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
