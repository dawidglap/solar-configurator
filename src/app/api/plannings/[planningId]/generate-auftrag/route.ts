import { ObjectId } from "mongodb";
import { getDb, getMongoClient } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  jsonResponse,
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  buildMontageTitleFromPlanning,
  defaultMontageChecklist,
  ensureMontageIndexes,
  extractAddressFromPlanning,
  getCustomersCollection,
  normalizeMontage,
  normalizeMontageAddress,
} from "@/lib/montages";
import {
  AUFTRAG_LOCKED_FIRST_STEP,
  buildInitialAuftragStepStates,
  ensureAuftragIndexes,
  ensureCompanyAuftragPipelineTemplate,
  getAuftraegeCollection,
  getSessionActor,
  normalizeAuftrag,
  runWithOptionalTransaction,
} from "@/lib/auftragPipeline";
import { buildStageHistoryForTransition, getWonStageKey } from "@/lib/plannings";
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

function isPlanningApproved(planning: any) {
  const status = safeString(planning?.status).toLowerCase();
  if (!status) return true;
  return status === "approved" || status === "genehmigt";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId || !session?.userId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  const { planningId } = await params;
  const planningObjectId = toObjectIdOrNull(planningId);
  if (!companyObjectId || !planningObjectId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Anfrage." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureAuftragIndexes(db), ensureMontageIndexes(db)]);

    const planning = await db.collection("plannings").findOne({
      _id: planningObjectId,
      companyId: activeCompanyId,
      ...activeDocumentFilter(),
    });
    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    if (!isPlanningApproved(planning)) {
      return jsonResponse(origin, { ok: false, message: "Planning ist nicht freigegeben." }, 409);
    }

    const existingAuftrag = await getAuftraegeCollection(db).findOne({
      companyId: companyObjectId,
      planningId: planningObjectId,
    });
    if (existingAuftrag) {
      const montageId = toObjectIdOrNull((existingAuftrag as any)?.montageId);
      const montage = montageId
        ? await db.collection("montages").findOne({ _id: montageId, companyId: companyObjectId })
        : await db.collection("montages").findOne({ planningId: planningObjectId, companyId: companyObjectId });
      return jsonResponse(
        origin,
        {
          ok: true,
          auftrag: normalizeAuftrag(existingAuftrag),
          montage: montage ? normalizeMontage(montage) : null,
        },
        200,
      );
    }

    const companies = db.collection("companies");
    const company = await companies.findOne({ _id: companyObjectId });
    if (!company) {
      return jsonResponse(origin, { ok: false, message: "Company not found" }, 404);
    }

    const customerObjectId = toObjectIdOrNull((planning as any)?.customerId);
    const customer = customerObjectId
      ? await getCustomersCollection(db).findOne({ _id: customerObjectId })
      : null;

    const client = await getMongoClient();
    const actor = getSessionActor(session);
    const result = await runWithOptionalTransaction(client, async (txnSession) => {
      const now = new Date();
      const template = await ensureCompanyAuftragPipelineTemplate(db, companyObjectId, actor);
      const templateSteps = (template as any)?.steps ?? [];
      const existingMontage = await db.collection("montages").findOne(
        {
          companyId: companyObjectId,
          planningId: planningObjectId,
        },
        txnSession ? { session: txnSession } : undefined,
      );

      let montageDoc = existingMontage;
      if (!montageDoc) {
        const montageInsert = {
          companyId: companyObjectId,
          projectId:
            toObjectIdOrNull((planning as any)?.projectId) ??
            toObjectIdOrNull((planning as any)?.data?.projectId) ??
            null,
          planningId: planningObjectId,
          offerId:
            toObjectIdOrNull((planning as any)?.offerId) ??
            toObjectIdOrNull((planning as any)?.data?.offerId) ??
            null,
          customerId: customerObjectId ?? null,
          title: buildMontageTitleFromPlanning(planning, customer),
          status: "offen",
          paymentStatus: "unpaid",
          montageReady: true,
          startDate: null,
          endDate: null,
          startTime: null,
          endTime: null,
          assignedInstallerIds: [] as ObjectId[],
          address: normalizeMontageAddress(extractAddressFromPlanning(planning, customer)),
          notes: "",
          checklist: defaultMontageChecklist(),
          createdAt: now,
          updatedAt: now,
          createdBy: toObjectIdOrNull(session.userId) ?? session.userId,
        };
        const insertMontage = await db.collection("montages").insertOne(
          montageInsert,
          txnSession ? { session: txnSession } : undefined,
        );
        montageDoc = { ...montageInsert, _id: insertMontage.insertedId };
      }

      const stepsState = buildInitialAuftragStepStates(templateSteps, actor, now);
      const auftragDoc = {
        companyId: companyObjectId,
        planningId: planningObjectId,
        montageId: (montageDoc as any)._id,
        status: "aktiv",
        currentStepKey: templateSteps[0]?.key || AUFTRAG_LOCKED_FIRST_STEP.key,
        stepsState,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
      };
      const insertAuftrag = await getAuftraegeCollection(db).insertOne(
        auftragDoc,
        txnSession ? { session: txnSession } : undefined,
      );

      await db.collection("plannings").updateOne(
        {
          _id: planningObjectId,
          companyId: activeCompanyId,
          ...activeDocumentFilter(),
        },
        {
          $set: {
            won: true,
            "commercial.stage": getWonStageKey(company),
            "commercial.stageHistory": buildStageHistoryForTransition(
              planning,
              getWonStageKey(company),
              session as any,
            ),
            "data.montageId": mongoIdToString((montageDoc as any)._id),
            "data.montageStatus": safeString((montageDoc as any)?.status) || "offen",
            "data.montageReady": true,
            updatedAt: now,
          },
        },
        txnSession ? { session: txnSession } : undefined,
      );

      return {
        auftrag: { ...auftragDoc, _id: insertAuftrag.insertedId },
        montage: montageDoc,
      };
    });

    const normalizedAuftrag = normalizeAuftrag(result.auftrag);
    const normalizedMontage = normalizeMontage(result.montage);
    const orderId = safeString(planning?.orderId);
    await emitCompanyRealtimeEvent(activeCompanyId, "order.created", {
      planningId,
      ...(orderId ? { orderId } : {}),
      auftragId: normalizedAuftrag.id,
      createdAt: new Date().toISOString(),
    });
    await emitCompanyRealtimeEvent(activeCompanyId, "auftrag:updated", {
      auftragId: normalizedAuftrag.id,
      currentStepKey: normalizedAuftrag.currentStepKey,
      status: normalizedAuftrag.status,
    });
    await emitCompanyRealtimeEvent(activeCompanyId, "montage:updated", {
      montageId: normalizedMontage.id,
      status: normalizedMontage.status,
    });

    return jsonResponse(
      origin,
      {
        ok: true,
        auftrag: normalizedAuftrag,
        montage: normalizedMontage,
      },
      200,
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("E11000")) {
      const db = await getDb();
      const existingAuftrag = await getAuftraegeCollection(db).findOne({
        companyId: companyObjectId,
        planningId: planningObjectId,
      });
      if (existingAuftrag) {
        const montageId = toObjectIdOrNull((existingAuftrag as any)?.montageId);
        const montage = montageId
          ? await db.collection("montages").findOne({ _id: montageId, companyId: companyObjectId })
          : null;
        return jsonResponse(
          origin,
          {
            ok: true,
            auftrag: normalizeAuftrag(existingAuftrag),
            montage: montage ? normalizeMontage(montage) : null,
          },
          200,
        );
      }
    }

    console.error("GENERATE AUFTRAG ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
