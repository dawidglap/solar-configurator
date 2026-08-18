import { getDb, getMongoClient } from "@/lib/db";
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
import {
  createInvoicesForOrderIfMissing,
  ensureInvoiceIndexes,
  getInvoicesCollection,
  getPlannedInvoiceRates,
  normalizeInvoice,
  normalizePlanningPaymentTerms,
} from "@/lib/invoices";
import {
  buildPlanningDocumentPdf,
  resolveReportSections,
  type PlanningReportSections,
} from "@/lib/planningDocuments";
import { buildStageHistoryForTransition, getWonStageKey } from "@/lib/plannings";
import {
  AUFTRAG_LOCKED_FIRST_STEP,
  buildInitialAuftragStepStates,
  ensureCompanyAuftragPipelineTemplate,
  ensureAuftragIndexes,
  ensureAuftragStepStateForOrder,
  getHydratedAuftragState,
  getSessionActor,
  persistAuftragStepsState,
  runWithOptionalTransaction,
} from "@/lib/auftragPipeline";
import {
  ensurePlanningFileIndexes,
  extractPlanningFileCustomerId,
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  normalizePlanningFile,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";
import { ensureExecutionTasksForWonPlanning } from "@/lib/executionTasks";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type GenerateOrderErrorCode =
  | "PLANNING_NOT_FOUND"
  | "COMPANY_NOT_FOUND"
  | "NO_INVOICE_RATES"
  | "INVOICE_RATES_INVALID"
  | "COMPANY_IBAN_MISSING"
  | "ORDER_NUMBER_SEQUENCE_FAILED"
  | "ORDER_DOCUMENT_PDF_FAILED"
  | "AUFTRAG_INIT_FAILED"
  | "INVOICE_CREATION_FAILED"
  | "INTERNAL";

class GenerateOrderError extends Error {
  code: GenerateOrderErrorCode;
  status: number;
  cause?: unknown;

  constructor(code: GenerateOrderErrorCode, message: string, status = 400, cause?: unknown) {
    super(message);
    this.name = "GenerateOrderError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

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

function buildErrorResponseBody(error: GenerateOrderError | Error | unknown) {
  const normalized =
    error instanceof GenerateOrderError
      ? error
      : new GenerateOrderError("INTERNAL", "Auftrag konnte nicht generiert werden.", 500, error);
  const body: Record<string, unknown> = {
    ok: false,
    code: normalized.code,
    message: normalized.message,
  };

  if (process.env.NODE_ENV !== "production") {
    body.details = {
      name: (normalized.cause as any)?.name ?? normalized.name,
      code: (normalized.cause as any)?.code ?? normalized.code,
      message: (normalized.cause as any)?.message ?? normalized.message,
      stack: (normalized.cause as any)?.stack ?? normalized.stack ?? null,
    };
  }

  return {
    status: normalized.status,
    body,
  };
}

function classifyGenerateOrderError(error: unknown) {
  if (error instanceof GenerateOrderError) {
    return error;
  }

  const code = String((error as any)?.code ?? "");
  const message = String((error as any)?.message ?? "");
  const keyPattern = (error as any)?.keyPattern ?? {};

  if (
    (code === "11000" || Number((error as any)?.code) === 11000) &&
    keyPattern?.orderId === 1
  ) {
    return new GenerateOrderError(
      "ORDER_NUMBER_SEQUENCE_FAILED",
      "Auftragsnummer konnte nicht eindeutig erzeugt werden.",
      500,
      error,
    );
  }

  if (
    (code === "11000" || Number((error as any)?.code) === 11000) &&
    keyPattern?.montageId === 1
  ) {
    return new GenerateOrderError(
      "AUFTRAG_INIT_FAILED",
      "Auftrag-Pipeline konnte nicht initialisiert werden.",
      500,
      error,
    );
  }

  if (message.includes("Ungültige Planning-ID")) {
    return new GenerateOrderError("PLANNING_NOT_FOUND", "Planung nicht gefunden.", 404, error);
  }

  return new GenerateOrderError("INTERNAL", "Auftrag konnte nicht generiert werden.", 500, error);
}

async function buildAngebotSnapshotBuffer(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  files: ReturnType<typeof getPlanningFilesCollection>;
  planning: any;
  company: any;
  session: any;
  planningId: string;
  sections: PlanningReportSections;
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
    sections: args.sections,
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
  sections: PlanningReportSections;
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
      title: `Auftragsbestätigung ${args.orderId}`,
      originalFileName: `auftragsbestaetigung-${args.orderId}.pdf`,
      mimeType: "application/pdf",
      buffer: args.orderPdfBuffer,
      customerId,
      session: args.session,
    });
    orderFile = result.doc;
  } catch (error) {
    console.error("UPSERT AUFTRAG FILE ERROR:", error);
    warnings.push("Auftragsbestätigungs-PDF konnte nicht in Dateien gespeichert werden.");
  }

  try {
    const angebotSnapshotBuffer = await buildAngebotSnapshotBuffer({
      db: args.db,
      files: getPlanningFilesCollection(args.db),
      planning: args.planning,
      company: args.company,
      session: args.session,
      planningId: args.planningId,
      sections: args.sections,
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
  const companyId = String(session.activeCompanyId);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

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
      const errorResponse = buildErrorResponseBody(
        new GenerateOrderError("PLANNING_NOT_FOUND", "Planung nicht gefunden.", 404),
      );
      return jsonResponse(origin, errorResponse.body, errorResponse.status);
    }

    const company = await companies.findOne({ _id: companyObjectId });
    if (!company) {
      const errorResponse = buildErrorResponseBody(
        new GenerateOrderError("COMPANY_NOT_FOUND", "Firma nicht gefunden.", 404),
      );
      return jsonResponse(origin, errorResponse.body, errorResponse.status);
    }

    const alreadyGenerated = safeString((planning as any)?.orderStatus) === "generated";
    if (alreadyGenerated) {
      await ensureAuftragIndexes(db);
      await ensureInvoiceIndexes(db);
      const orderId = safeString((planning as any)?.orderId);
      const actor = getSessionActor(session);
      const hydratedAuftrag =
        orderId
          ? await getHydratedAuftragState({
              db,
              companyId: companyObjectId,
              orderId,
              actor,
            })
          : null;
      const invoices = orderId
        ? await getInvoicesCollection(db)
            .find({
              companyId,
              orderId,
            })
            .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
            .toArray()
        : [];
      const planningFiles = await getPlanningFilesCollection(db)
        .find({
          companyId,
          planningId,
          isDeleted: { $ne: true },
          category: { $in: ["auftrag", "angebot_snapshot"] },
        })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();
      const orderFile = planningFiles.find((file: any) => safeString(file?.category) === "auftrag") ?? null;
      const angebotSnapshotFile =
        planningFiles.find((file: any) => safeString(file?.category) === "angebot_snapshot") ?? null;

      return jsonResponse(
        origin,
        {
          ok: true,
          alreadyGenerated: true,
          message: "Auftrag wurde bereits generiert.",
          order: {
            orderId,
            status: "generated",
            currentStepKey:
              hydratedAuftrag?.normalizedAuftrag.currentStepKey || AUFTRAG_LOCKED_FIRST_STEP.key,
            completedAt: hydratedAuftrag?.normalizedAuftrag.completedAt || null,
          },
          planning: normalizePlanningForOrder(planning),
          invoices: invoices.map((invoice: any) => normalizeInvoice(invoice)),
          stepsState: hydratedAuftrag?.stepsState ?? [],
          checklist: hydratedAuftrag?.checklist ?? { items: [], updatedAt: new Date().toISOString() },
          auftrag: hydratedAuftrag?.normalizedAuftrag ?? null,
          orderId,
          orderStatus: "generated",
          orderSnapshotFileId:
            safeString((planning as any)?.orderSnapshotFileId?.toString?.() ?? (planning as any)?.orderSnapshotFileId) ||
            null,
          angebotSnapshotFileId:
            safeString(
              (planning as any)?.angebotSnapshotFileId?.toString?.() ?? (planning as any)?.angebotSnapshotFileId,
            ) || null,
          files: {
            auftrag: orderFile
              ? {
                  id: safeString(orderFile?._id?.toString?.() ?? orderFile?._id),
                  cloudinarySecureUrl: safeString(orderFile?.cloudinarySecureUrl),
                }
              : null,
            angebotSnapshot: angebotSnapshotFile
              ? {
                  id: safeString(angebotSnapshotFile?._id?.toString?.() ?? angebotSnapshotFile?._id),
                  cloudinarySecureUrl: safeString(angebotSnapshotFile?.cloudinarySecureUrl),
                }
              : null,
          },
          ...(orderFile ? { orderFile: normalizePlanningFile(orderFile) } : {}),
        },
        409,
      );
    }

    const paymentTerms = normalizePlanningPaymentTerms(planning);
    const paymentValidation = getPlannedInvoiceRates(planning);
    if (!paymentValidation.ok) {
      const errorResponse = buildErrorResponseBody(
        new GenerateOrderError("INVOICE_RATES_INVALID", paymentValidation.message, 400),
      );
      return jsonResponse(origin, errorResponse.body, errorResponse.status);
    }
    if (!alreadyGenerated && !paymentTerms && paymentValidation.items.length === 0) {
      const errorResponse = buildErrorResponseBody(
        new GenerateOrderError(
          "NO_INVOICE_RATES",
          "Mindestens eine Zahlungsrate erforderlich.",
          400,
        ),
      );
      return jsonResponse(origin, errorResponse.body, errorResponse.status);
    }

    const iban = (company?.bank?.iban || company?.billing?.iban || "").replace(/\s/g, "");
    if (!iban) {
      const errorResponse = buildErrorResponseBody(
        new GenerateOrderError(
          "COMPANY_IBAN_MISSING",
          "IBAN in den Firmeneinstellungen hinterlegen.",
          400,
        ),
      );
      return jsonResponse(origin, errorResponse.body, errorResponse.status);
    }

    const now = new Date();
    const wonStageKey = getWonStageKey(company);
    const sections = resolveReportSections(planning);
    const orderId = safeString((planning as any)?.orderId) || (alreadyGenerated ? "" : await (async () => {
      try {
        return await nextOrderId(db, companyId, now);
      } catch (error) {
        throw new GenerateOrderError(
          "ORDER_NUMBER_SEQUENCE_FAILED",
          "Auftragsnummer konnte nicht erzeugt werden.",
          500,
          error,
        );
      }
    })());
    const orderGeneratedAt =
      (planning as any)?.orderGeneratedAt instanceof Date
        ? (planning as any).orderGeneratedAt
        : safeString((planning as any)?.orderGeneratedAt)
          ? new Date(String((planning as any).orderGeneratedAt))
          : now;

    if (!orderId) {
      throw new GenerateOrderError(
        "ORDER_NUMBER_SEQUENCE_FAILED",
        "Auftragsnummer fehlt.",
        500,
      );
    }

    const { pdfBytes, pricing } = await (async () => {
      try {
        return await buildPlanningDocumentPdf({
          db,
          planning,
          company,
          session,
          documentType: "auftrag",
          orderId,
          orderGeneratedAt,
          sections,
        });
      } catch (error) {
        throw new GenerateOrderError(
          "ORDER_DOCUMENT_PDF_FAILED",
          "Auftrag-PDF konnte nicht erzeugt werden.",
          500,
          error,
        );
      }
    })();

    const actor = getSessionActor(session);
    const client = await getMongoClient();
    await ensureAuftragIndexes(db);

    await runWithOptionalTransaction(client, async (txnSession) => {
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
          txnSession ? { session: txnSession } : undefined,
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
          txnSession ? { session: txnSession } : undefined,
        );
      }

      const template = await ensureCompanyAuftragPipelineTemplate(db, companyObjectId, actor);
      const templateSteps = (template as any)?.steps ?? [];
      const existingAuftrag =
        (await db.collection("auftraege").findOne(
          {
            companyId: companyObjectId,
            $or: [{ orderId }, { planningId: planningObjectId }],
          },
          txnSession ? { session: txnSession } : undefined,
        )) ?? null;

      let auftragDoc = existingAuftrag;
      if (!auftragDoc) {
        const insertDoc = {
          companyId: companyObjectId,
          orderId,
          planningId: planningObjectId,
          status: "aktiv",
          currentStepKey: AUFTRAG_LOCKED_FIRST_STEP.key,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
        };
        const insert = await db.collection("auftraege").insertOne(
          insertDoc,
          txnSession ? { session: txnSession } : undefined,
        );
        auftragDoc = { ...insertDoc, _id: insert.insertedId };
        await persistAuftragStepsState({
          db,
          companyId: companyObjectId,
          orderId,
          templateSteps,
          stepsState: buildInitialAuftragStepStates(templateSteps, actor, now),
          session: txnSession,
        });
      } else {
        await db.collection("auftraege").updateOne(
          { _id: (auftragDoc as any)._id, companyId: companyObjectId },
          {
            $set: {
              orderId,
              planningId: planningObjectId,
              updatedAt: now,
            },
          },
          txnSession ? { session: txnSession } : undefined,
        );
        auftragDoc = { ...auftragDoc, orderId, planningId: planningObjectId, updatedAt: now };
        await ensureAuftragStepStateForOrder({
          db,
          companyId: companyObjectId,
          orderId,
          templateSteps,
          auftrag: auftragDoc,
          session: txnSession,
        });
      }
    }).catch((error) => {
      throw error instanceof GenerateOrderError
        ? error
        : new GenerateOrderError(
            "AUFTRAG_INIT_FAILED",
            "Auftrag konnte nicht initialisiert werden.",
            500,
            error,
          );
    });

    const invoiceResult = await (async () => {
      try {
        return await createInvoicesForOrderIfMissing({
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
      } catch (error) {
        throw new GenerateOrderError(
          "INVOICE_CREATION_FAILED",
          "Rechnungen konnten nicht erstellt werden.",
          500,
          error,
        );
      }
    })();

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
      sections,
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
    let executionTasksWarning: string | null = null;
    if (updatedPlanning && safeString((updatedPlanning as any)?.commercial?.stage) === wonStageKey) {
      try {
        await ensureExecutionTasksForWonPlanning(db, updatedPlanning, session as any);
      } catch (error) {
        executionTasksWarning = "Execution tasks konnten nicht synchronisiert werden.";
        console.error(
          "[generate-order:execution-tasks] planningId=%s companyId=%s",
          planningId,
          companyId,
          error,
        );
      }
    }
    const hydratedAuftrag = await getHydratedAuftragState({
      db,
      companyId: companyObjectId,
      orderId,
      actor,
    });
    const responseBody = {
      ok: true,
      alreadyGenerated,
      ...(alreadyGenerated ? { message: "Auftrag wurde bereits generiert." } : {}),
      order: {
        orderId,
        status: "generated",
        currentStepKey: hydratedAuftrag?.normalizedAuftrag.currentStepKey || AUFTRAG_LOCKED_FIRST_STEP.key,
        completedAt: hydratedAuftrag?.normalizedAuftrag.completedAt || null,
      },
      planning: normalizePlanningForOrder(updatedPlanning),
      invoices: invoiceResult.invoices.map((invoice: any) => normalizeInvoice(invoice)),
      stepsState: hydratedAuftrag?.stepsState ?? [],
      checklist: hydratedAuftrag?.checklist ?? { items: [], updatedAt: new Date().toISOString() },
      auftrag: hydratedAuftrag?.normalizedAuftrag ?? null,
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
      ...(executionTasksWarning ? { executionTasksWarning } : {}),
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

    await emitCompanyRealtimeEvent(companyId, "orders", {
      orderId,
      status: "generated",
      currentStepKey: hydratedAuftrag?.normalizedAuftrag.currentStepKey || AUFTRAG_LOCKED_FIRST_STEP.key,
    });
    await emitCompanyRealtimeEvent(companyId, "auftrag-steps", {
      orderId,
      stepsState: hydratedAuftrag?.stepsState ?? [],
    });
    await emitCompanyRealtimeEvent(companyId, "planning-checklist", {
      planningId,
      checklist: hydratedAuftrag?.checklist ?? { items: [], updatedAt: new Date().toISOString() },
    });

    return jsonResponse(origin, responseBody, alreadyGenerated ? 409 : 200);
  } catch (e: any) {
    console.error("[generate-order] planningId=%s companyId=%s", planningId, companyId, e);
    console.error("[generate-order:error-meta]", {
      planningId,
      companyId,
      name: e?.name ?? null,
      code: e?.code ?? null,
      message: e?.message ?? null,
      stack: e?.stack ?? null,
    });
    const errorResponse = buildErrorResponseBody(classifyGenerateOrderError(e));
    return jsonResponse(origin, errorResponse.body, errorResponse.status);
  }
}
