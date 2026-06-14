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
import { createInvoicesForOrderIfMissing } from "@/lib/invoices";
import { buildPlanningDocumentPdf } from "@/lib/planningDocuments";
import { buildStageHistoryForTransition, getWonStageKey } from "@/lib/plannings";
import {
  ensurePlanningFileIndexes,
  extractPlanningFileCustomerId,
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  normalizePlanningFile,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";
import { ensureExecutionTasksForWonPlanning } from "@/lib/executionTasks";

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

async function buildAngebotSnapshotBuffer(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  files: ReturnType<typeof getPlanningFilesCollection>;
  planning: any;
  company: any;
  session: any;
  planningId: string;
}) {
  const currentOfferFile = await args.files.findOne(
    {
      companyId: safeString(args.planning?.companyId),
      planningId: args.planningId,
      isDeleted: { $ne: true },
      mimeType: "application/pdf",
      $or: [
        { category: "offer" },
        { type: "angebot" },
      ],
    },
    {
      sort: { createdAt: -1, _id: -1 },
    },
  );

  if (currentOfferFile) {
    return fetchPlanningFileBuffer(currentOfferFile);
  }

  const { pdfBytes } = await buildPlanningDocumentPdf({
    db: args.db,
    planning: args.planning,
    company: args.company,
    session: args.session,
    documentType: "angebot",
  });

  return pdfBytes;
}

async function persistManagedOrderFiles(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  companyId: string;
  planningId: string;
  planning: any;
  company: any;
  session: any;
  orderId: string;
  orderGeneratedAt: Date | string;
  orderPdfBuffer: Buffer;
}) {
  const warnings: string[] = [];
  const customerId = extractPlanningFileCustomerId(args.planning);
  let orderFile: any = null;
  let angebotSnapshotFile: any = null;

  try {
    const result = await upsertManagedPlanningFile({
      db: args.db,
      companyId: args.companyId,
      planningId: args.planningId,
      category: "auftrag",
      title: `Auftrag ${args.orderId}`,
      originalFileName: `auftrag-${args.orderId}.pdf`,
      mimeType: "application/pdf",
      buffer: args.orderPdfBuffer,
      customerId,
      session: args.session,
    });
    orderFile = result.doc;
  } catch (error) {
    console.error("UPSERT AUFTRAG FILE ERROR:", error);
    warnings.push("Auftrag-PDF konnte nicht in Dateien gespeichert werden.");
  }

  try {
    const angebotSnapshotBuffer = await buildAngebotSnapshotBuffer({
      db: args.db,
      files: getPlanningFilesCollection(args.db),
      planning: args.planning,
      company: args.company,
      session: args.session,
      planningId: args.planningId,
    });

    const result = await upsertManagedPlanningFile({
      db: args.db,
      companyId: args.companyId,
      planningId: args.planningId,
      category: "angebot_snapshot",
      title: `Angebot Snapshot — ${args.orderId}`,
      originalFileName: `angebot-snapshot-${args.orderId}.pdf`,
      mimeType: "application/pdf",
      buffer: angebotSnapshotBuffer,
      customerId,
      session: args.session,
    });
    angebotSnapshotFile = result.doc;
  } catch (error) {
    console.error("UPSERT ANGEBOT SNAPSHOT FILE ERROR:", error);
    warnings.push("Angebot-Snapshot konnte nicht in Dateien gespeichert werden.");
  }

  return {
    orderFile,
    angebotSnapshotFile,
    fileWarning: warnings.length ? warnings.join(" ") : null,
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
    await ensurePlanningFileIndexes(db);

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
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

    const alreadyGenerated = safeString((planning as any)?.orderStatus) === "generated";
    const now = new Date();
    const wonStageKey = getWonStageKey(company);
    const orderId =
      safeString((planning as any)?.orderId) ||
      (alreadyGenerated ? "" : await nextOrderId(db, companyId, now));
    const orderGeneratedAt =
      (planning as any)?.orderGeneratedAt instanceof Date
        ? (planning as any).orderGeneratedAt
        : safeString((planning as any)?.orderGeneratedAt)
          ? new Date(String((planning as any).orderGeneratedAt))
          : now;

    if (!orderId) {
      return jsonResponse(origin, { ok: false, message: "Auftragsnummer fehlt." }, 500);
    }

    const { pdfBytes, pricing } = await buildPlanningDocumentPdf({
      db,
      planning,
      company,
      session,
      documentType: "auftrag",
      orderId,
      orderGeneratedAt,
    });

    if (!alreadyGenerated) {
      const auditFields = buildOrderAuditFields(session);
      await plannings.updateOne(
        { _id: planningObjectId, companyId },
        {
          $set: {
            orderStatus: "generated",
            orderId,
            orderGeneratedAt,
            orderGeneratedByUserId: auditFields.orderGeneratedByUserId,
            orderGeneratedByName: auditFields.orderGeneratedByName,
            commercialLockedAt: now,
            "commercial.stage": wonStageKey,
            "commercial.stageHistory": buildStageHistoryForTransition(
              planning,
              wonStageKey,
              session,
            ),
            updatedAt: now,
          },
        },
      );
    } else if (safeString((planning as any)?.commercial?.stage) !== wonStageKey) {
      await plannings.updateOne(
        { _id: planningObjectId, companyId },
        {
          $set: {
            "commercial.stage": wonStageKey,
            "commercial.stageHistory": buildStageHistoryForTransition(
              planning,
              wonStageKey,
              session,
            ),
            updatedAt: now,
          },
        },
      );
    }

    await createInvoicesForOrderIfMissing({
      db,
      companyId,
      planning: alreadyGenerated
        ? {
            ...planning,
            orderStatus: "generated",
            orderId,
            orderGeneratedAt,
          }
        : planning,
      company,
      session,
      orderId,
      orderGeneratedAt:
        orderGeneratedAt instanceof Date ? orderGeneratedAt : new Date(orderGeneratedAt),
      totalInklMwst: Number(pricing?.totalInklMwst ?? 0),
    });

    const managedFiles = await persistManagedOrderFiles({
      db,
      companyId,
      planningId,
      planning: alreadyGenerated
        ? {
            ...planning,
            orderStatus: "generated",
            orderId,
            orderGeneratedAt,
          }
        : planning,
      company,
      session,
      orderId,
      orderGeneratedAt,
      orderPdfBuffer: pdfBytes,
    });

    if (managedFiles.orderFile || managedFiles.angebotSnapshotFile) {
      await plannings.updateOne(
        { _id: planningObjectId, companyId },
        {
          $set: {
            ...(managedFiles.orderFile
              ? { orderSnapshotFileId: managedFiles.orderFile._id }
              : {}),
            ...(managedFiles.angebotSnapshotFile
              ? { angebotSnapshotFileId: managedFiles.angebotSnapshotFile._id }
              : {}),
            updatedAt: new Date(),
          },
        },
      );
    }

    const updatedPlanning = await plannings.findOne({ _id: planningObjectId, companyId });
    if (updatedPlanning && safeString((updatedPlanning as any)?.commercial?.stage) === wonStageKey) {
      await ensureExecutionTasksForWonPlanning(db, updatedPlanning, session as any);
    }
    const responseBody = {
      ok: !alreadyGenerated,
      ...(alreadyGenerated ? { message: "Auftrag wurde bereits generiert." } : {}),
      planning: normalizePlanningForOrder(updatedPlanning),
      orderId,
      orderStatus: "generated",
      orderSnapshotFileId:
        managedFiles.orderFile?._id?.toString?.() ??
        (safeString(
          (updatedPlanning as any)?.orderSnapshotFileId?.toString?.() ??
            (updatedPlanning as any)?.orderSnapshotFileId,
        ) || null),
      angebotSnapshotFileId:
        managedFiles.angebotSnapshotFile?._id?.toString?.() ??
        (safeString(
          (updatedPlanning as any)?.angebotSnapshotFileId?.toString?.() ??
            (updatedPlanning as any)?.angebotSnapshotFileId,
        ) || null),
      ...(managedFiles.fileWarning ? { fileWarning: managedFiles.fileWarning } : {}),
      files: {
        auftrag: managedFiles.orderFile
          ? {
              id: safeString(managedFiles.orderFile?._id?.toString?.() ?? managedFiles.orderFile?._id),
              cloudinarySecureUrl: safeString(managedFiles.orderFile?.cloudinarySecureUrl),
            }
          : null,
        angebotSnapshot: managedFiles.angebotSnapshotFile
          ? {
              id: safeString(
                managedFiles.angebotSnapshotFile?._id?.toString?.() ??
                  managedFiles.angebotSnapshotFile?._id,
              ),
              cloudinarySecureUrl: safeString(managedFiles.angebotSnapshotFile?.cloudinarySecureUrl),
            }
          : null,
      },
      ...(managedFiles.orderFile
        ? {
            orderFile: normalizePlanningFile(managedFiles.orderFile),
          }
        : {}),
    };

    return jsonResponse(origin, responseBody, alreadyGenerated ? 409 : 200);
  } catch (e: any) {
    console.error("GENERATE ORDER ERROR:", e);
    return jsonResponse(origin, { ok: false, message: "Auftrag konnte nicht generiert werden." }, 500);
  }
}
