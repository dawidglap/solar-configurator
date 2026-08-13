import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { buildIdVariants } from "@/lib/tasks";
import {
  buildInternalOrderSession,
  buildOfferAuditEntry,
  buildOfferVollmachtResponse,
  enforceOfferPublicRateLimit,
  ensureOfferSignatureIndexes,
  findOfferForVollmacht,
  getOfferVollmachtExpiresAt,
  parseOfferVollmachtDetails,
} from "@/lib/offerSignatures";
import {
  appendOfferConfirmationSignatureProtocol,
  buildContentDispositionInline,
  createOfferConfirmationPdf,
  createOfferVollmachtPdf,
  extractRequestIp,
  getPublicApiBaseUrl,
  loadPlanningCustomer,
  normalizeSignaturePayments,
  resolveCustomerName,
  validateSignatureImage,
} from "@/lib/orderSignatures";
import {
  buildPlanningDocumentPdf,
  computePlanningCommercialSummary,
  resolveReportSections,
} from "@/lib/planningDocuments";
import {
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ token: string }> };

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

async function loadVollmachtContext(req: Request, token: string) {
  const db = await getDb();
  await ensureOfferSignatureIndexes(db);
  if (!(await enforceOfferPublicRateLimit(db, req))) return { rateLimited: true as const };
  const planning = await findOfferForVollmacht(db, token);
  if (!planning) return { notFound: true as const };
  const companyId = mongoIdToString(planning?.companyId) || safeString(planning?.companyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const [company, customer] = await Promise.all([
    companyObjectId ? db.collection("companies").findOne({ _id: companyObjectId }) : null,
    loadPlanningCustomer(db, planning),
  ]);
  return { db, planning, company, customer, companyId };
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = safeString((await params).token);
  try {
    const context = await loadVollmachtContext(req, token);
    if ("rateLimited" in context) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    if ("notFound" in context) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (new URL(req.url).searchParams.get("download") === "1") {
      const fileId = toObjectIdOrNull(context.planning?.offerVollmachtPdfFileId);
      if (!fileId) return response(origin, { ok: false, message: "PDF nicht gefunden." }, 404);
      const file = await getPlanningFilesCollection(context.db).findOne({
        _id: fileId,
        companyId: context.companyId,
        planningId: mongoIdToString(context.planning?._id),
        category: "vollmacht",
        isDeleted: { $ne: true },
      });
      if (!file) return response(origin, { ok: false, message: "PDF nicht gefunden." }, 404);
      const pdf = await fetchPlanningFileBuffer(file);
      if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("Vollmacht-Datei ist kein PDF.");
      }
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": buildContentDispositionInline(
            safeString(file.originalFileName) || `vollmacht-${safeString(context.planning?.orderId)}.pdf`,
          ),
          "Content-Length": String(pdf.length),
          "Cache-Control": "private, no-store, max-age=0",
          ...getCorsHeaders(origin),
        },
      });
    }
    return response(origin, {
      ok: true,
      vollmacht: buildOfferVollmachtResponse({
        planning: context.planning,
        company: context.company,
        customer: context.customer,
        token,
        req,
      }),
    });
  } catch (error) {
    console.error("GET PUBLIC OFFER VOLLMACHT ERROR:", error);
    return response(origin, { ok: false, message: "Vollmacht konnte nicht geladen werden." }, 500);
  }
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = safeString((await params).token);
  try {
    const context = await loadVollmachtContext(req, token);
    if ("rateLimited" in context) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    if ("notFound" in context) return response(origin, { ok: false, message: "Link ungültig." }, 404);

    const body = await req.json().catch(() => ({}));
    const details = parseOfferVollmachtDetails(body);
    const { db, company, customer, companyId } = context;
    const planningId = context.planning._id;
    const customerId = context.customer?._id ?? toObjectIdOrNull(context.planning?.customerId);
    const orderId = safeString(context.planning?.orderId);
    if (!company || !companyId || !orderId) {
      throw new Error("Auftragsdaten sind unvollständig.");
    }

    const now = new Date();
    const sharedFields = {
      propertyStreet: details.propertyStreet,
      propertyZip: details.propertyZip,
      propertyCity: details.propertyCity,
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      parcelNumberSource: "manual",
      buildingNumberSource: "manual",
      subsidyPayoutAccountHolder: details.bankAccountHolder,
      subsidyPayoutIban: details.bankIban,
      updatedAt: now,
    };
    await Promise.all([
      db.collection("plannings").updateOne(
        { _id: planningId, offerSignatureTokenHash: context.planning.offerSignatureTokenHash },
        {
          $set: {
            ...sharedFields,
            "data.profile.buildingStreet": details.propertyStreet,
            "data.profile.buildingStreetNo": null,
            "data.profile.buildingZip": details.propertyZip,
            "data.profile.buildingCity": details.propertyCity,
            "data.profile.parcelNumber": details.parcelNumber,
            "data.profile.landRegisterNumber": details.landRegisterNumber,
            "data.profile.parcelNumberSource": "manual",
            "data.profile.buildingNumberSource": "manual",
          },
        },
      ),
      db.collection("auftraege").updateOne(
        {
          companyId: { $in: buildIdVariants(companyId) },
          $or: [{ orderId }, { planningId: { $in: buildIdVariants(mongoIdToString(planningId)) } }],
        },
        { $set: sharedFields },
      ),
      customerId
        ? db.collection("customers").updateOne(
            { _id: customerId, companyId: { $in: buildIdVariants(companyId) } },
            {
              $set: {
                buildingStreet: details.propertyStreet,
                buildingStreetNo: null,
                buildingZip: details.propertyZip,
                buildingCity: details.propertyCity,
                parcelNumber: details.parcelNumber,
                landRegisterNumber: details.landRegisterNumber,
                parcelNumberSource: "manual",
                buildingNumberSource: "manual",
                subsidyPayoutAccountHolder: details.bankAccountHolder,
                subsidyPayoutIban: details.bankIban,
                updatedAt: now,
              },
            },
          )
        : Promise.resolve(null),
    ]);

    const planning = await db.collection<any>("plannings").findOne({ _id: planningId });
    if (!planning) throw new Error("Planung nicht gefunden.");
    const commercial = await computePlanningCommercialSummary(db, planning);
    const session = { ...buildInternalOrderSession(planning, safeString(planning?.offerSignerName)), userId: null, name: "System" };
    const orderGeneratedAt = planning?.orderGeneratedAt || planning?.offerSignedAt || now;
    const { pdfBytes: orderPdf } = await buildPlanningDocumentPdf({
      db,
      planning,
      company,
      session,
      documentType: "auftrag",
      orderId,
      orderGeneratedAt,
      sections: resolveReportSections(planning),
    });
    const customerName = resolveCustomerName(planning, customer);
    const totalInklMwst = Number(commercial?.totalInvestmentChf ?? 0);
    const signedAt = planning?.offerSignedAt instanceof Date
      ? planning.offerSignedAt
      : new Date(planning?.offerSignedAt);
    const withdrawalUntil = planning?.withdrawalUntil
      ? new Date(planning.withdrawalUntil)
      : null;
    const confirmationBasePdf = await createOfferConfirmationPdf({
      sourcePdf: orderPdf,
      orderId,
      offerNumber: safeString(planning?.planningNumber),
      customerName,
      projectTitle: safeString(planning?.title) || safeString(planning?.planningNumber),
      signerName: safeString(planning?.offerSignerName),
      signedAt,
      totalInklMwst,
      payments: normalizeSignaturePayments(planning, totalInklMwst),
      propertyStreet: details.propertyStreet,
      propertyHouseNumber: null,
      propertyZip: details.propertyZip,
      propertyCity: details.propertyCity,
      buildingNumber: safeString(planning?.buildingNumber ?? planning?.egid ?? planning?.data?.profile?.buildingNumber),
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      bankAccountHolder: details.bankAccountHolder,
      bankIban: details.bankIban,
      withdrawalRightApplies: planning?.withdrawalRightApplies === true,
      withdrawalUntil: withdrawalUntil && !Number.isNaN(withdrawalUntil.getTime()) ? withdrawalUntil : null,
    });
    const signaturePng = validateSignatureImage(planning?.offerSignatureImage);
    const confirmationPdf = await appendOfferConfirmationSignatureProtocol({
      confirmationPdf: confirmationBasePdf,
      signaturePng,
      orderId,
      customerName,
      projectTitle: safeString(planning?.title) || safeString(planning?.planningNumber),
      totalInklMwst,
      signerName: safeString(planning?.offerSignerName),
      signerEmail: safeString(planning?.offerSignerEmail),
      place: safeString(planning?.offerSignaturePlaceName) || "Remote",
      signedAt,
      signerIp: safeString(planning?.offerSignerIp) || extractRequestIp(req),
      signerUserAgent: safeString(planning?.offerSignerUserAgent),
      signedOfferSha256: safeString(planning?.offerSignedPdfSha256),
    });
    const vollmachtPdf = await createOfferVollmachtPdf({
      company,
      orderId,
      offerNumber: safeString(planning?.planningNumber),
      customerName,
      propertyStreet: details.propertyStreet,
      propertyZip: details.propertyZip,
      propertyCity: details.propertyCity,
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      bankAccountHolder: details.bankAccountHolder,
      bankIban: details.bankIban,
      submittedAt: now,
    });
    const [confirmation, vollmacht] = await Promise.all([
      upsertManagedPlanningFile({
        db,
        companyId,
        planningId: mongoIdToString(planningId),
        category: "auftrag",
        title: `Auftragsbestätigung ${orderId}`,
        originalFileName: `auftragsbestaetigung-${orderId}.pdf`,
        mimeType: "application/pdf",
        buffer: confirmationPdf,
        customerId: safeString(planning?.customerId) || undefined,
        session,
      }),
      upsertManagedPlanningFile({
        db,
        companyId,
        planningId: mongoIdToString(planningId),
        category: "vollmacht",
        title: `Vollmacht ${orderId}`,
        originalFileName: `vollmacht-${orderId}.pdf`,
        mimeType: "application/pdf",
        buffer: vollmachtPdf,
        customerId: safeString(planning?.customerId) || undefined,
        session,
      }),
    ]);

    const expiresAt = getOfferVollmachtExpiresAt(planning);
    await Promise.all([
      db.collection<any>("plannings").updateOne(
        { _id: planningId },
        {
          $set: {
            vollmachtSubmittedAt: now,
            offerVollmachtPdfFileId: vollmacht.doc._id,
            offerConfirmationPdfFileId: confirmation.doc._id,
            orderSnapshotFileId: confirmation.doc._id,
            updatedAt: now,
          },
          $push: {
            offerSignatureAudit: buildOfferAuditEntry({
              event: "vollmacht_submitted",
              req,
              tokenHash: safeString(planning?.offerSignatureTokenHash),
              at: now,
              meta: { orderId, expiresAt: expiresAt?.toISOString() ?? null },
            }) as never,
          },
        },
      ),
      db.collection("auftraege").updateOne(
        { companyId: { $in: buildIdVariants(companyId) }, orderId },
        { $set: { vollmachtSubmittedAt: now, updatedAt: now } },
      ),
      customerId
        ? db.collection("customers").updateOne(
            { _id: customerId, companyId: { $in: buildIdVariants(companyId) } },
            { $set: { vollmachtSubmittedAt: now, updatedAt: now } },
          )
        : Promise.resolve(null),
    ]);

    const publicBase = `${getPublicApiBaseUrl(req)}/api/public/offer-signature/${encodeURIComponent(token)}`;
    return response(origin, {
      ok: true,
      vollmachtPdfUrl: `${publicBase}/vollmacht?download=1`,
      confirmationPdfUrl: `${publicBase}/pdf?type=confirmation`,
    });
  } catch (error: any) {
    const message = safeString(error?.message) || "Vollmacht konnte nicht gespeichert werden.";
    if (/erforderlich|maximal|IBAN/.test(message)) return response(origin, { ok: false, message }, 400);
    console.error("POST PUBLIC OFFER VOLLMACHT ERROR:", error);
    return response(origin, { ok: false, message }, 500);
  }
}
