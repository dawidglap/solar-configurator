import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildOrderAuditFields,
  canGenerateOrders,
  nextOrderId,
  normalizeOrderFields,
  toCompanyObjectId,
  toPlanningObjectId,
} from "@/lib/orders";
import { buildPlanningDocumentPdf } from "@/lib/planningDocuments";
import {
  ensurePlanningFileIndexes,
  extractPlanningFileCustomerId,
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  normalizePlanningFile,
  uploadGeneratedPlanningFileBuffer,
} from "@/lib/planningFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function normalizePlanningForOrder(planning: any) {
  return {
    id: safeString(planning?._id?.toString?.() ?? planning?._id),
    title: safeString(planning?.title),
    planningNumber: safeString(planning?.planningNumber),
    customerId: safeString(planning?.customerId) || null,
    commercial: {
      stage: safeString(planning?.commercial?.stage) || "lead",
      valueChf: Number(planning?.commercial?.valueChf ?? 0),
    },
    ...normalizeOrderFields(planning),
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  if (!canGenerateOrders(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung für Aufträge." }, 403);
  }

  const { planningId } = await params;

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const companyId = String(session.activeCompanyId);
    const planningObjectId = toPlanningObjectId(planningId);
    const companyObjectId = toCompanyObjectId(companyId);
    const plannings = db.collection("plannings");
    const companies = db.collection("companies");
    const files = getPlanningFilesCollection(db);
    await ensurePlanningFileIndexes(db);

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    }

    if (safeString((planning as any)?.orderStatus) === "generated") {
      return jsonResponse(
        origin,
        {
          ok: false,
          message: "Auftrag wurde bereits generiert.",
          planning: normalizePlanningForOrder(planning),
          orderId: safeString((planning as any)?.orderId) || null,
          orderSnapshotFileId:
            safeString((planning as any)?.orderSnapshotFileId?.toString?.() ?? (planning as any)?.orderSnapshotFileId) ||
            null,
          angebotSnapshotFileId:
            safeString((planning as any)?.angebotSnapshotFileId?.toString?.() ?? (planning as any)?.angebotSnapshotFileId) ||
            null,
        },
        409,
      );
    }

    const company = await companies.findOne({ _id: companyObjectId });
    if (!company) {
      return jsonResponse(origin, { ok: false, message: "Firma nicht gefunden." }, 404);
    }

    const iban = (company?.bank?.iban || company?.billing?.iban || "").replace(/\s/g, "");
    if (!iban) {
      return jsonResponse(
        origin,
        { ok: false, message: "IBAN in Firmeneinstellungen ergänzen." },
        400,
      );
    }

    let angebotSnapshotFileId: ObjectId | null = null;
    const currentOfferFile = await files.findOne({
      companyId,
      planningId,
      isDeleted: { $ne: true },
      mimeType: "application/pdf",
      $or: [
        { type: "angebot" },
        { type: { $exists: false }, category: "offer" },
      ],
    }, {
      sort: { createdAt: -1, _id: -1 },
    });

    if (currentOfferFile) {
      const snapshotBuffer = await fetchPlanningFileBuffer(currentOfferFile);
      const snapshotDoc = await uploadGeneratedPlanningFileBuffer({
        companyId,
        planningId,
        category: "offer",
        type: "angebot_snapshot",
        linkToPlanningId: planningId,
        title: `Angebot Snapshot ${safeString((planning as any)?.planningNumber) || planningId}`,
        originalFileName: `Angebot_Snapshot_${safeString((planning as any)?.planningNumber) || planningId}.pdf`,
        mimeType: "application/pdf",
        buffer: snapshotBuffer,
        customerId: extractPlanningFileCustomerId(planning),
        session,
      });
      const insertSnapshot = await files.insertOne(snapshotDoc);
      angebotSnapshotFileId = insertSnapshot.insertedId;
    }

    const now = new Date();
    const orderId = await nextOrderId(db, companyId, now);
    const { pdfBytes } = await buildPlanningDocumentPdf({
      db,
      planning,
      company,
      session,
      documentType: "auftrag",
      orderId,
      orderGeneratedAt: now,
    });

    const orderFileDoc = await uploadGeneratedPlanningFileBuffer({
      companyId,
      planningId,
      category: "offer",
      type: "auftrag",
      linkToPlanningId: planningId,
      title: `Auftrag ${orderId}`,
      originalFileName: `${orderId}.pdf`,
      mimeType: "application/pdf",
      buffer: pdfBytes,
      customerId: extractPlanningFileCustomerId(planning),
      session,
    });
    const insertedOrderFile = await files.insertOne(orderFileDoc);
    const orderSnapshotFileId = insertedOrderFile.insertedId;

    const auditFields = buildOrderAuditFields(session);
    await plannings.updateOne(
      { _id: planningObjectId, companyId },
      {
        $set: {
          orderStatus: "generated",
          orderId,
          orderGeneratedAt: now,
          orderGeneratedByUserId: auditFields.orderGeneratedByUserId,
          orderGeneratedByName: auditFields.orderGeneratedByName,
          commercialLockedAt: now,
          orderSnapshotFileId,
          angebotSnapshotFileId,
          updatedAt: now,
        },
      },
    );

    const updatedPlanning = await plannings.findOne({ _id: planningObjectId, companyId });
    return jsonResponse(
      origin,
      {
        ok: true,
        planning: normalizePlanningForOrder(updatedPlanning),
        orderId,
        orderSnapshotFileId: String(orderSnapshotFileId),
        angebotSnapshotFileId: angebotSnapshotFileId ? String(angebotSnapshotFileId) : null,
        orderFile: normalizePlanningFile({ ...orderFileDoc, _id: orderSnapshotFileId }),
      },
      200,
    );
  } catch (e: any) {
    console.error("GENERATE ORDER ERROR:", e);
    return jsonResponse(origin, { ok: false, message: "Auftrag konnte nicht generiert werden." }, 500);
  }
}
