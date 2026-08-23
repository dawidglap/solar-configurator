import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { buildIdVariants } from "@/lib/tasks";
import {
  OFFER_VOLLMACHT_VALIDITY_MS,
  buildInternalOrderSession,
  buildOfferAuditEntry,
  buildOfferVollmachtResponse,
  enforceOfferPublicRateLimit,
  ensureOfferSignatureIndexes,
  findOfferForVollmacht,
  getOfferVollmachtExpiresAt,
  isOfferVollmachtRequired,
  parseOfferVollmachtDetails,
  resolveVollmachtTokenContext,
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
  resolveCustomerEmail,
  resolveCustomerName,
  storeGeneratedSignatureFile,
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
import { resolvePlanningSellerContact } from "@/lib/userProfiles";
import { queueSignatureDocumentEmail } from "@/lib/signatureEmails";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

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
  const tokenContext = resolveVollmachtTokenContext(planning, token);
  if (!tokenContext) return { notFound: true as const };
  const companyId = mongoIdToString(planning?.companyId) || safeString(planning?.companyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const [company, customer] = await Promise.all([
    companyObjectId ? db.collection("companies").findOne({ _id: companyObjectId }) : null,
    loadPlanningCustomer(db, planning),
  ]);
  return { db, planning, company, customer, companyId, tokenContext };
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const token = safeString((await params).token);
  try {
    const context = await loadVollmachtContext(req, token);
    if ("rateLimited" in context) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    if ("notFound" in context) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (new URL(req.url).searchParams.get("download") === "1") {
      if (!isOfferVollmachtRequired(context.planning)) {
        return response(origin, { ok: false, message: "Vollmacht ist für diese Offerte nicht aktiviert." }, 404);
      }
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
            safeString(file.originalFileName) ||
              `vollmacht-${safeString(context.planning?.orderId) || safeString(context.planning?.planningNumber) || mongoIdToString(context.planning?._id)}.pdf`,
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
    if (!isOfferVollmachtRequired(context.planning)) {
      return response(
        origin,
        {
          ok: false,
          code: "VOLLMACHT_NOT_REQUIRED",
          message: "Vollmacht ist für diese Offerte nicht aktiviert.",
        },
        409,
      );
    }

    const body = await req.json().catch(() => ({}));
    const details = parseOfferVollmachtDetails(body, {
      signatureRequired: context.tokenContext.signatureRequired,
    });
    const { db, company, customer, companyId } = context;
    const planningId = context.planning._id;
    const customerId = context.customer?._id ?? toObjectIdOrNull(context.planning?.customerId);
    const orderId = safeString(context.planning?.orderId);
    const isManualRequest = context.tokenContext.kind === "manual";
    if (!company || !companyId || (!isManualRequest && !orderId)) {
      throw new Error(isManualRequest ? "Firmendaten sind unvollständig." : "Auftragsdaten sind unvollständig.");
    }

    const now = new Date();
    const signerIp = extractRequestIp(req);
    const signerUserAgent = safeString(req.headers.get("user-agent")).slice(0, 1000);
    const sharedFields = {
      propertyStreet: details.propertyStreet,
      propertyZip: details.propertyZip,
      propertyCity: details.propertyCity,
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      buildingNumber: details.buildingNumber,
      vollmachtParcelNumber: details.parcelNumber,
      vollmachtLandRegisterNumber: details.landRegisterNumber,
      vollmachtBuildingNumber: details.buildingNumber,
      parcelNumberSource: "manual",
      buildingNumberSource: "manual",
      subsidyPayoutAccountHolder: details.bankAccountHolder,
      subsidyPayoutIban: details.bankIban,
      vollmachtBankName: details.bankName,
      vollmachtOwnerCompanyName: details.ownerCompanyName,
      vollmachtOwnerFirstName: details.ownerFirstName,
      vollmachtOwnerLastName: details.ownerLastName,
      vollmachtOwnerBirthDate: details.ownerBirthDate,
      vollmachtOwnerPhone: details.ownerPhone,
      vollmachtOwnerEmail: details.ownerEmail,
      vollmachtSignerFirstName: details.signerFirstName,
      vollmachtSignerLastName: details.signerLastName,
      vollmachtSignerName: details.signerName,
      vollmachtSignatureDate: details.signatureDate,
      vollmachtSignatureMethod: details.signatureMethod,
      vollmachtSignedAt: details.signaturePng ? now : null,
      vollmachtSignerIp: signerIp,
      vollmachtSignerUserAgent: signerUserAgent,
      updatedAt: now,
    };
    await Promise.all([
      db.collection("plannings").updateOne(
        {
          _id: planningId,
          ...(isManualRequest
            ? { vollmachtRequestTokenHash: context.tokenContext.tokenHash }
            : { offerSignatureTokenHash: context.tokenContext.tokenHash }),
        },
        {
          $set: {
            ...sharedFields,
            "data.profile.buildingStreet": details.propertyStreet,
            "data.profile.buildingStreetNo": null,
            "data.profile.buildingZip": details.propertyZip,
            "data.profile.buildingCity": details.propertyCity,
            "data.profile.parcelNumber": details.parcelNumber,
            "data.profile.landRegisterNumber": details.landRegisterNumber,
            "data.profile.buildingNumber": details.buildingNumber,
            "data.profile.parcelNumberSource": "manual",
            "data.profile.buildingNumberSource": "manual",
          },
        },
      ),
      db.collection("auftraege").updateOne(
        {
          companyId: { $in: buildIdVariants(companyId) },
          $or: [
            ...(orderId ? [{ orderId }] : []),
            { planningId: { $in: buildIdVariants(mongoIdToString(planningId)) } },
          ],
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
                buildingNumber: details.buildingNumber,
                parcelNumberSource: "manual",
                buildingNumberSource: "manual",
                subsidyPayoutAccountHolder: details.bankAccountHolder,
                subsidyPayoutIban: details.bankIban,
                subsidyPayoutBankName: details.bankName,
                updatedAt: now,
              },
            },
          )
        : Promise.resolve(null),
    ]);

    const planning = await db.collection<any>("plannings").findOne({ _id: planningId });
    if (!planning) throw new Error("Planung nicht gefunden.");
    const session = { ...buildInternalOrderSession(planning, safeString(planning?.offerSignerName)), userId: null, name: "System" };
    const customerName = resolveCustomerName(planning, customer);
    const documentReference = orderId || safeString(planning?.planningNumber) || mongoIdToString(planningId);
    let confirmation: Awaited<ReturnType<typeof upsertManagedPlanningFile>> | null = null;
    if (!isManualRequest) {
      const commercial = await computePlanningCommercialSummary(db, planning);
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
        buildingNumber: details.buildingNumber,
        parcelNumber: details.parcelNumber,
        landRegisterNumber: details.landRegisterNumber,
        bankAccountHolder: details.bankAccountHolder,
        bankIban: details.bankIban,
        withdrawalRightApplies: planning?.withdrawalRightApplies === true,
        withdrawalUntil: withdrawalUntil && !Number.isNaN(withdrawalUntil.getTime())
          ? withdrawalUntil
          : null,
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
      confirmation = await upsertManagedPlanningFile({
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
      });
    }
    const vollmachtPdf = await createOfferVollmachtPdf({
      company,
      orderId: documentReference,
      offerNumber: safeString(planning?.planningNumber),
      customerName,
      propertyStreet: details.propertyStreet,
      propertyZip: details.propertyZip,
      propertyCity: details.propertyCity,
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      buildingNumber: details.buildingNumber,
      bankAccountHolder: details.bankAccountHolder,
      bankName: details.bankName,
      bankIban: details.bankIban,
      ownerCompanyName: details.ownerCompanyName,
      ownerFirstName: details.ownerFirstName,
      ownerLastName: details.ownerLastName,
      ownerBirthDate: details.ownerBirthDate,
      ownerPhone: details.ownerPhone,
      ownerEmail: details.ownerEmail,
      signerName: details.signerName,
      signatureDate: details.signatureDate,
      signaturePng: details.signaturePng,
      signatureMethod: details.signatureMethod,
      submittedAt: now,
    });
    const [vollmacht, vollmachtSignature] = await Promise.all([
      upsertManagedPlanningFile({
        db,
        companyId,
        planningId: mongoIdToString(planningId),
        category: "vollmacht",
        title: `Vollmacht ${documentReference}`,
        originalFileName: `vollmacht-${documentReference}.pdf`,
        mimeType: "application/pdf",
        buffer: vollmachtPdf,
        customerId: safeString(planning?.customerId) || undefined,
        session,
      }),
      details.signaturePng
        ? storeGeneratedSignatureFile({
            db,
            planning,
            category: "signature",
            type: "vollmacht_signature",
            title: `Vollmacht ${documentReference} - Unterschrift`,
            fileName: `vollmacht-${documentReference}-unterschrift.png`,
            mimeType: "image/png",
            buffer: details.signaturePng,
            actorName: "System",
          })
        : Promise.resolve(null),
    ]);

    const currentExpiresAt = getOfferVollmachtExpiresAt(planning, token);
    const minimumLinkExpiresAt = new Date(now.getTime() + OFFER_VOLLMACHT_VALIDITY_MS);
    const expiresAt = isManualRequest
      ? context.tokenContext.expiresAt
      : currentExpiresAt && currentExpiresAt > minimumLinkExpiresAt
        ? currentExpiresAt
        : minimumLinkExpiresAt;
    const signatureFileId = vollmachtSignature?._id ?? null;
    const signatureRecord = {
      parcelNumber: details.parcelNumber,
      landRegisterNumber: details.landRegisterNumber,
      buildingNumber: details.buildingNumber,
      bankName: details.bankName,
      ownerCompanyName: details.ownerCompanyName,
      ownerFirstName: details.ownerFirstName,
      ownerLastName: details.ownerLastName,
      ownerBirthDate: details.ownerBirthDate,
      ownerPhone: details.ownerPhone,
      ownerEmail: details.ownerEmail,
      signerFirstName: details.signerFirstName,
      signerLastName: details.signerLastName,
      signerName: details.signerName,
      signatureDate: details.signatureDate,
      signatureMethod: details.signatureMethod,
      signatureImageFileId: signatureFileId,
      signedAt: details.signaturePng ? now : null,
      ip: signerIp,
      userAgent: signerUserAgent,
    };
    const auditEntry = buildOfferAuditEntry({
      event: "vollmacht_submitted",
      req,
      tokenHash: context.tokenContext.tokenHash,
      at: now,
      meta: {
        orderId: orderId || null,
        expiresAt: expiresAt.toISOString(),
        signerName: details.signerName,
        signatureRequired: context.tokenContext.signatureRequired,
        signatureDate: details.signatureDate,
        signatureMethod: details.signatureMethod,
        signatureImageFileId: mongoIdToString(signatureFileId),
        signedAt: details.signaturePng ? now.toISOString() : null,
      },
    });
    await Promise.all([
      db.collection<any>("plannings").updateOne(
        {
          _id: planningId,
          ...(isManualRequest
            ? { vollmachtRequestTokenHash: context.tokenContext.tokenHash }
            : { offerSignatureTokenHash: context.tokenContext.tokenHash }),
        },
        {
          $set: {
            vollmachtSubmittedAt: now,
            offerVollmachtPdfFileId: vollmacht.doc._id,
            ...(confirmation
              ? {
                  offerConfirmationPdfFileId: confirmation.doc._id,
                  orderSnapshotFileId: confirmation.doc._id,
                  offerVollmachtTokenExpiresAt: expiresAt,
                }
              : {}),
            vollmachtSignatureImageFileId: signatureFileId,
            vollmachtSignature: signatureRecord,
            updatedAt: now,
          },
          $push: {
            ...(isManualRequest
              ? { vollmachtRequestAudit: auditEntry as never }
              : { offerSignatureAudit: auditEntry as never }),
          },
        },
      ),
      db.collection("auftraege").updateOne(
        {
          companyId: { $in: buildIdVariants(companyId) },
          $or: [
            ...(orderId ? [{ orderId }] : []),
            { planningId: { $in: buildIdVariants(mongoIdToString(planningId)) } },
          ],
        },
        {
          $set: {
            ...sharedFields,
            vollmachtSubmittedAt: now,
            vollmachtSignatureImageFileId: signatureFileId,
            vollmachtSignature: signatureRecord,
            updatedAt: now,
          },
        },
      ),
      customerId
        ? db.collection("customers").updateOne(
            { _id: customerId, companyId: { $in: buildIdVariants(companyId) } },
            { $set: { vollmachtSubmittedAt: now, updatedAt: now } },
          )
        : Promise.resolve(null),
    ]);

    await emitCompanyRealtimeEvent(companyId, "vollmacht.submitted", {
      planningId: mongoIdToString(planningId),
      ...(orderId ? { orderId } : {}),
      submittedAt: now.toISOString(),
    });

    const publicBase = `${getPublicApiBaseUrl(req)}/api/public/offer-signature/${encodeURIComponent(token)}`;
    try {
      const seller = await resolvePlanningSellerContact({ db, planning, company });
      await queueSignatureDocumentEmail({
        db,
        kind: "vollmacht_submitted",
        companyId,
        planningId: mongoIdToString(planningId),
        orderId: documentReference,
        offerNumber: safeString(planning?.planningNumber),
        companyName: safeString(company?.name),
        customerName,
        customerEmail:
          resolveCustomerEmail(planning, customer) || safeString(planning?.offerSignerEmail),
        sellerName: seller.sellerName,
        sellerEmail: seller.sellerEmail,
        downloadUrl: `${publicBase}/vollmacht?download=1`,
        attachment: {
          fileId: vollmacht.doc._id,
          fileName: `vollmacht-${documentReference}.pdf`,
          mimeType: "application/pdf",
          buffer: vollmachtPdf,
        },
      });
    } catch (error) {
      console.error("QUEUE VOLLMACHT EMAIL ERROR:", error);
    }
    return response(origin, {
      ok: true,
      vollmachtPdfUrl: `${publicBase}/vollmacht?download=1`,
      confirmationPdfUrl: confirmation ? `${publicBase}/pdf?type=confirmation` : null,
      submittedAt: now.toISOString(),
    });
  } catch (error: any) {
    const message = safeString(error?.message) || "Vollmacht konnte nicht gespeichert werden.";
    if (/erforderlich|maximal|IBAN|Unterschrift|Unterschrifts|PNG|Format|ungültig/i.test(message)) {
      return response(origin, { ok: false, message }, 400);
    }
    console.error("POST PUBLIC OFFER VOLLMACHT ERROR:", error);
    return response(origin, { ok: false, message }, 500);
  }
}
