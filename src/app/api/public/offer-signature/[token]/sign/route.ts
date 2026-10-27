import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  appendOfferConfirmationSignatureProtocol,
  createOfferConfirmationPdf,
  createSignedOrderPdf,
  extractRequestIp,
  getPublicApiBaseUrl,
  loadPlanningCustomer,
  normalizeSignaturePayments,
  resolveCustomerEmail,
  resolveCustomerName,
  sha256,
  storeGeneratedSignatureFile,
  validateSignatureImage,
} from "@/lib/orderSignatures";
import {
  OFFER_VOLLMACHT_VALIDITY_MS,
  buildInternalOrderSession,
  buildOfferAuditEntry,
  buildSignatureCustomerPayoutUpdate,
  buildOfferVollmachtLink,
  buildSignedSessionCookie,
  enforceOfferPublicRateLimit,
  ensureActiveOfferToken,
  ensureOfferSignatureIndexes,
  findOfferByToken,
  getHeatingOfferIssuedSnapshot,
  getOfferSnapshot,
  isOfferVollmachtRequired,
  normalizeOfferSignaturePlace,
  parseOfferAcceptanceDetails,
} from "@/lib/offerSignatures";
import {
  buildConfirmationPlanningFileTitle,
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  persistGeneratedPlanningPdfByTitle,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";
import { POST as generateOrder } from "@/app/api/plannings/[planningId]/generate-order/route";
import { buildIdVariants } from "@/lib/tasks";
import { resolvePlanningSellerContact } from "@/lib/userProfiles";
import { queueSignatureDocumentEmail } from "@/lib/signatureEmails";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";
import { resolveProjectType } from "@/lib/projectType";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const response = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }

function signedResult(req: Request, planning: any, token: string) {
  const base = getPublicApiBaseUrl(req);
  if (resolveProjectType(planning?.projectType) === "heating") {
    return {
      ok: true,
      projectType: "heating",
      documentTitle: "Heizungsangebot",
      orderId: null,
      signedPdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(token)}/pdf?type=signed`,
      confirmationPdfUrl: null,
      withdrawalRightApplies: false,
      withdrawalUntil: null,
    };
  }
  return {
    ok: true,
    orderId: safeString(planning?.orderId),
    signedPdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(token)}/pdf?type=signed`,
    confirmationPdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(token)}/pdf?type=confirmation`,
    withdrawalRightApplies: planning?.withdrawalRightApplies === true,
    withdrawalUntil:
      planning?.withdrawalUntil instanceof Date
        ? planning.withdrawalUntil.toISOString()
        : safeString(planning?.withdrawalUntil) || null,
  };
}

async function signHeatingOffer(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  planning: any;
  snapshot: Awaited<ReturnType<typeof getOfferSnapshot>>;
  req: Request;
  tokenHash: string;
  processingId: string;
  signerName: string;
  signerEmail: string;
  place: string;
  placeName: string;
  signatureImage: unknown;
  signaturePng: Buffer;
}) {
  const issued = getHeatingOfferIssuedSnapshot(args.planning);
  const signedAt = new Date();
  const signerIp = extractRequestIp(args.req);
  const signerUserAgent = safeString(args.req.headers.get("user-agent")).slice(0, 1000);
  const protocolPlace = args.placeName || (
    args.place === "onsite_customer"
      ? "Beim Kunden"
      : args.place === "onsite_company"
        ? "Geschäftsräume der Anbieterin"
        : args.place
  );
  const signedOffer = await createSignedOrderPdf({
    sourcePdf: args.snapshot.buffer,
    signaturePng: args.signaturePng,
    orderId: issued.offerNumber,
    customerName: issued.customer.name,
    projectTitle: issued.documentTitle,
    totalInklMwst: issued.pricing.totalGross,
    signerName: args.signerName,
    signerEmail: args.signerEmail,
    place: protocolPlace,
    signedAt,
    signerIp,
    signerUserAgent,
    sourcePdfSha256: args.snapshot.hash,
    documentKind: "Heizungsangebot",
    openedAt: args.planning?.offerSignatureViewedAt
      ? new Date(args.planning.offerSignatureViewedAt)
      : null,
    tokenId: args.tokenHash,
    signaturePlace: ["onsite_customer", "onsite_company"].includes(args.place)
      ? args.place
      : undefined,
    legalText: "Elektronische Annahme des Heizungsangebots und einfache elektronische Signatur (EES) gemäss Art. 1/3 ff. und Art. 14 OR.",
  });
  const signedPdfSha256 = sha256(signedOffer);
  const signedOfferFile = await storeGeneratedSignatureFile({
    db: args.db,
    planning: args.planning,
    category: "offer_signiert",
    title: `Heizungsangebot ${issued.offerNumber} (unterschrieben)`,
    fileName: `heizungsangebot-${issued.offerNumber}-unterschrieben.pdf`,
    mimeType: "application/pdf",
    buffer: signedOffer,
    actorName: "System",
  });
  const result = await args.db.collection<any>("plannings").updateOne(
    {
      _id: args.planning._id,
      offerSignatureTokenHash: args.tokenHash,
      offerSignatureProcessingId: args.processingId,
    },
    {
      $set: {
        offerSignatureStatus: "signed",
        offerSignedAt: signedAt,
        offerSignerName: args.signerName,
        offerSignerEmail: args.signerEmail,
        offerSignerIp: signerIp,
        offerSignerUserAgent: signerUserAgent,
        offerSignaturePlace: args.place,
        offerSignaturePlaceName: args.placeName || null,
        offerSignatureImage: safeString(args.signatureImage),
        offerSignedPdfFileId: signedOfferFile._id,
        offerSignedPdfSha256: signedPdfSha256,
        offerConfirmationPdfFileId: null,
        withdrawalRightApplies: false,
        withdrawalUntil: null,
        offerVollmachtTokenExpiresAt: null,
        offerVollmachtPdfFileId: null,
        offerSignatureProcessingId: null,
        offerSignatureProcessingAt: null,
        updatedAt: signedAt,
      },
      $push: {
        offerSignatureAudit: buildOfferAuditEntry({
          event: "signed",
          req: args.req,
          tokenHash: args.tokenHash,
          at: signedAt,
          meta: {
            projectType: "heating",
            signerName: args.signerName,
            signerEmail: args.signerEmail,
            place: args.place,
            placeName: args.placeName || null,
            viewedAt: args.planning.offerSignatureViewedAt ?? null,
            snapshotSha256: args.snapshot.hash,
            signedPdfSha256,
          },
        }) as never,
      },
    },
  );
  if (!result.matchedCount) throw new Error("Signaturstatus konnte nicht abgeschlossen werden.");
  await emitCompanyRealtimeEvent(safeString(args.planning?.companyId), "offer.signed", {
    planningId: String(args.planning._id),
    projectType: "heating",
    signedAt: signedAt.toISOString(),
  });
  const completed = await args.db.collection("plannings").findOne({ _id: args.planning._id });
  return completed;
}

async function generateHeatingOrderFromSignedOffer(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  planning: any;
  signerName: string;
  req: Request;
  origin: string | null;
  tokenHash: string;
}) {
  const failure = async (message: string, code?: string | null) => {
    await args.db.collection<any>("plannings").updateOne(
      { _id: args.planning._id },
      {
        $push: {
          offerSignatureAudit: buildOfferAuditEntry({
            event: "order_generation_failed",
            req: args.req,
            tokenHash: args.tokenHash,
            meta: { projectType: "heating", code: code || null, message },
          }) as never,
        },
      },
    );
    return {
      orderId: null,
      orderGeneration: { status: "failed", retryable: true, message },
    };
  };
  const secret = process.env.SESSION_SECRET;
  if (!secret) return failure("Auftrag konnte nicht automatisch erstellt werden.", "SESSION_SECRET_MISSING");
  try {
    const internalSession = buildInternalOrderSession(args.planning, args.signerName);
    const internalRequest = new Request(
      `${new URL(args.req.url).origin}/api/plannings/${args.planning._id}/generate-order`,
      {
        method: "POST",
        headers: {
          cookie: buildSignedSessionCookie(internalSession, secret),
          "content-type": "application/json",
          origin: args.origin || "https://app.helionic.ch",
        },
        body: "{}",
      },
    );
    const orderResponse = await generateOrder(internalRequest, {
      params: Promise.resolve({ planningId: String(args.planning._id) }),
    });
    const orderBody = await orderResponse.json().catch(() => ({}));
    if (orderBody?.ok === true && safeString(orderBody?.orderId)) {
      return {
        orderId: safeString(orderBody.orderId),
        orderGeneration: {
          status: orderBody?.alreadyGenerated === true ? "existing" : "created",
          retryable: false,
        },
      };
    }
    return failure(
      safeString(orderBody?.message) || "Auftrag konnte nicht automatisch erstellt werden.",
      safeString(orderBody?.code) || null,
    );
  } catch (error: any) {
    return failure(
      safeString(error?.message) || "Auftrag konnte nicht automatisch erstellt werden.",
      safeString(error?.code) || null,
    );
  }
}

async function deliverOfferAcceptedEmail(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  planning: any;
  token: string;
  req: Request;
  attachmentBuffer?: Buffer;
}) {
  try {
    const companyId = safeString(args.planning?.companyId);
    const companyObjectId = toObjectIdOrNull(companyId);
    const [company, customer] = await Promise.all([
      companyObjectId ? args.db.collection("companies").findOne({ _id: companyObjectId }) : null,
      loadPlanningCustomer(args.db, args.planning),
    ]);
    const seller = await resolvePlanningSellerContact({
      db: args.db,
      planning: args.planning,
      company,
    });
    const orderId = safeString(args.planning?.orderId);
    const publicBase = `${getPublicApiBaseUrl(args.req)}/api/public/offer-signature/${encodeURIComponent(args.token)}`;
    const vollmachtRequired = isOfferVollmachtRequired(args.planning);
    return queueSignatureDocumentEmail({
      db: args.db,
      kind: "offer_accepted",
      companyId,
      planningId: mongoIdToString(args.planning?._id),
      orderId,
      offerNumber: safeString(args.planning?.planningNumber),
      companyName: safeString(company?.name),
      customerName: resolveCustomerName(args.planning, customer),
      customerEmail:
        resolveCustomerEmail(args.planning, customer) || safeString(args.planning?.offerSignerEmail),
      sellerName: seller.sellerName,
      sellerEmail: seller.sellerEmail,
      downloadUrl: `${publicBase}/pdf?type=confirmation`,
      vollmachtRequired,
      vollmachtUrl: vollmachtRequired ? buildOfferVollmachtLink(args.token) : null,
      attachment: {
        fileId: args.planning?.offerConfirmationPdfFileId,
        fileName: `auftragsbestaetigung-${orderId}.pdf`,
        mimeType: "application/pdf",
        buffer: args.attachmentBuffer,
      },
    });
  } catch (error) {
    console.error("QUEUE OFFER ACCEPTED EMAIL ERROR:", error);
    return { status: "failed" } as const;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin");
  const token = safeString((await params).token);
  let claimedPlanningId: any = null;
  let processingId = "";
  try {
    const db = await getDb();
    await ensureOfferSignatureIndexes(db);
    if (!(await enforceOfferPublicRateLimit(db, req))) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    let planning = await findOfferByToken(db, token);
    if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (planning.offerSignatureStatus === "signed") {
      if (resolveProjectType(planning?.projectType) === "heating") {
        const orderResult = await generateHeatingOrderFromSignedOffer({
          db,
          planning,
          signerName: safeString(planning?.offerSignerName),
          req,
          origin,
          tokenHash: sha256(token),
        });
        return response(origin, { ...signedResult(req, planning, token), ...orderResult });
      } else {
        await deliverOfferAcceptedEmail({ db, planning, token, req });
      }
      return response(origin, signedResult(req, planning, token));
    }
    planning = await ensureActiveOfferToken(db, planning);
    if (!planning || !["sent", "viewed"].includes(planning.offerSignatureStatus)) return response(origin, { ok: false, message: "Offerte kann mit diesem Link nicht unterschrieben werden." }, 409);

    const body = await req.json().catch(() => ({}));
    if (body?.acceptedTerms === false) return response(origin, { ok: false, message: "Die Bedingungen müssen akzeptiert werden." }, 400);
    const signerName = safeString(body?.signerName).slice(0, 200);
    const signerEmail = safeString(body?.signerEmail).toLowerCase().slice(0, 320);
    const placeName = safeString(body?.placeName);
    const place = normalizeOfferSignaturePlace(body?.place);
    const isHeating = resolveProjectType(planning?.projectType) === "heating";
    const acceptance = isHeating ? null : parseOfferAcceptanceDetails(body);
    const bankAccountHolder = acceptance?.bankAccountHolder ?? null;
    const bankIban = acceptance?.bankIban ?? null;
    if (!signerName) return response(origin, { ok: false, message: "Name ist erforderlich." }, 400);
    if (!EMAIL_PATTERN.test(signerEmail)) return response(origin, { ok: false, message: "Ungültige E-Mail-Adresse." }, 400);
    const signatureImage = body?.signatureImage ?? body?.signatureData;
    const signaturePng = validateSignatureImage(signatureImage);

    processingId = crypto.randomUUID();
    const staleBefore = new Date(Date.now() - 15 * 60_000);
    const claimed = await db.collection<any>("plannings").findOneAndUpdate(
      {
        _id: planning._id,
        offerSignatureTokenHash: sha256(token),
        offerSignatureStatus: { $in: ["sent", "viewed"] },
        $or: [
          { offerSignatureProcessingId: null },
          { offerSignatureProcessingId: { $exists: false } },
          { offerSignatureProcessingAt: { $lt: staleBefore } },
        ],
      },
      { $set: { offerSignatureProcessingId: processingId, offerSignatureProcessingAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!claimed) {
      const current = await findOfferByToken(db, token);
      if (current?.offerSignatureStatus === "signed") return response(origin, signedResult(req, current, token));
      return response(origin, { ok: false, message: "Die Offerte wird bereits verarbeitet. Bitte erneut versuchen." }, 409);
    }
    planning = claimed;
    claimedPlanningId = planning._id;

    const snapshot = await getOfferSnapshot(db, planning);
    if (isHeating) {
      const tokenHash = sha256(token);
      const completed = await signHeatingOffer({
        db,
        planning,
        snapshot,
        req,
        tokenHash,
        processingId,
        signerName,
        signerEmail,
        place,
        placeName,
        signatureImage,
        signaturePng,
      });
      const orderResult = await generateHeatingOrderFromSignedOffer({
        db,
        planning: completed,
        signerName,
        req,
        origin,
        tokenHash,
      });
      return response(origin, { ...signedResult(req, completed, token), ...orderResult });
    }
    const customer = await loadPlanningCustomer(db, planning);
    const profile = planning?.data?.profile ?? {};
    const propertyStreet =
      acceptance!.propertyStreet || safeString(profile?.buildingStreet) || safeString(customer?.buildingStreet) || null;
    const propertyHouseNumber =
      acceptance!.propertyHouseNumber || safeString(profile?.buildingStreetNo) || safeString(customer?.buildingStreetNo) || null;
    const propertyZip =
      acceptance!.propertyZip || safeString(profile?.buildingZip) || safeString(customer?.buildingZip) || null;
    const propertyCity =
      acceptance!.propertyCity || safeString(profile?.buildingCity) || safeString(customer?.buildingCity) || null;
    const buildingNumber =
      acceptance!.buildingNumber ||
      safeString(profile?.buildingNumber ?? profile?.egid) ||
      safeString(customer?.buildingNumber ?? customer?.egid) ||
      null;
    const parcelNumber =
      acceptance!.parcelNumber || safeString(profile?.parcelNumber) || safeString(customer?.parcelNumber) || null;
    const landRegisterNumber =
      safeString(planning?.landRegisterNumber) ||
      safeString(profile?.landRegisterNumber) ||
      safeString(customer?.landRegisterNumber) ||
      null;
    const buildingNumberSource = acceptance!.buildingNumber
      ? "manual"
      : safeString(profile?.buildingNumberSource ?? customer?.buildingNumberSource) === "manual"
        ? "manual"
        : "auto";
    const parcelNumberSource = acceptance!.parcelNumber
      ? "manual"
      : safeString(profile?.parcelNumberSource ?? customer?.parcelNumberSource) === "manual"
        ? "manual"
        : "auto";
    const commercial = await computePlanningCommercialSummary(db, planning);
    const signedAt = new Date();
    const vollmachtRequired = isOfferVollmachtRequired(planning);
    const offerVollmachtTokenExpiresAt = vollmachtRequired
      ? new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS)
      : null;
    const tokenHash = sha256(token);
    const signerIp = extractRequestIp(req);
    const signerUserAgent = safeString(req.headers.get("user-agent")).slice(0, 1000);
    const offerNumber = safeString(planning?.planningNumber);
    const customerName = resolveCustomerName(planning, customer);
    const projectTitle = safeString(planning?.title) || offerNumber;
    const protocolPlace = placeName || (
      place === "onsite_customer"
        ? "Beim Kunden"
        : place === "onsite_company"
          ? "Geschäftsräume der Anbieterin"
          : place
    );
    const signedOffer = await createSignedOrderPdf({
      sourcePdf: snapshot.buffer,
      signaturePng,
      orderId: offerNumber,
      customerName,
      projectTitle,
      totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
      signerName,
      signerEmail,
      place: protocolPlace,
      signedAt,
      signerIp,
      signerUserAgent,
      sourcePdfSha256: snapshot.hash,
      documentKind: "Angebot",
      openedAt: planning?.offerSignatureViewedAt ? new Date(planning.offerSignatureViewedAt) : null,
      tokenId: tokenHash,
      signaturePlace: ["onsite_customer", "onsite_company"].includes(place)
        ? place
        : undefined,
      legalText: "Elektronische Annahme des Angebots und einfache elektronische Signatur (EES) gemäss Art. 1/3 ff. und Art. 14 OR.",
    });
    const signedPdfSha256 = sha256(signedOffer);
    const signedOfferFile = await storeGeneratedSignatureFile({
      db,
      planning,
      category: "offer_signiert",
      title: `Angebot ${offerNumber} (unterschrieben)`,
      fileName: `angebot-${offerNumber}-unterschrieben.pdf`,
      mimeType: "application/pdf",
      buffer: signedOffer,
      actorName: "System",
    });

    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET fehlt.");
    const internalSession = buildInternalOrderSession(planning, signerName);
    const systemSession = {
      ...internalSession,
      userId: null,
      name: "System",
    };
    const internalRequest = new Request(`${new URL(req.url).origin}/api/plannings/${planning._id}/generate-order`, {
      method: "POST",
      headers: {
        cookie: buildSignedSessionCookie(internalSession, secret),
        "content-type": "application/json",
        origin: origin || "https://app.helionic.ch",
      },
      body: "{}",
    });
    const orderResponse = await generateOrder(internalRequest, { params: Promise.resolve({ planningId: String(planning._id) }) });
    const orderBody = await orderResponse.json().catch(() => ({}));
    if (!(orderBody?.ok === true && safeString(orderBody?.orderId))) {
      throw new Error(safeString(orderBody?.message) || "Auftrag konnte nicht automatisch generiert werden.");
    }
    const orderId = safeString(orderBody.orderId);
    const signedOfferSnapshot = await upsertManagedPlanningFile({
      db,
      companyId: safeString(planning.companyId),
      planningId: String(planning._id),
      category: "angebot_snapshot",
      title: `Angebot ${offerNumber} (unterschrieben)`,
      originalFileName: `angebot-${offerNumber}-unterschrieben.pdf`,
      mimeType: "application/pdf",
      buffer: signedOffer,
      customerId: safeString(planning.customerId) || undefined,
      session: systemSession,
    });
    const generatedPlanning = await db.collection<any>("plannings").findOne({ _id: planning._id });
    const orderFileId = toObjectIdOrNull(generatedPlanning?.orderSnapshotFileId);
    if (!orderFileId) throw new Error("Auftrags-PDF wurde nicht gespeichert.");
    const orderFile = await getPlanningFilesCollection(db).findOne({ _id: orderFileId, companyId: safeString(planning.companyId), planningId: String(planning._id), category: "auftrag", isDeleted: { $ne: true } });
    if (!orderFile) throw new Error("Auftrags-PDF wurde nicht gefunden.");
    const orderPdf = await fetchPlanningFileBuffer(orderFile);
    const withdrawalRightApplies = place === "onsite_customer";
    const withdrawalUntil = withdrawalRightApplies
      ? new Date(signedAt.getTime() + 14 * 86_400_000)
      : null;
    const payments = normalizeSignaturePayments(planning, Number(commercial?.grossPriceChf ?? 0));
    const confirmationBasePdf = await createOfferConfirmationPdf({
      sourcePdf: orderPdf,
      orderId,
      offerNumber,
      customerName,
      projectTitle,
      signerName,
      signedAt,
      totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
      payments,
      propertyStreet,
      propertyHouseNumber,
      propertyZip,
      propertyCity,
      buildingNumber,
      parcelNumber,
      landRegisterNumber,
      bankAccountHolder,
      bankIban,
      withdrawalRightApplies,
      withdrawalUntil,
    });
    const confirmationPdf = await appendOfferConfirmationSignatureProtocol({
      confirmationPdf: confirmationBasePdf,
      signaturePng,
      orderId,
      customerName,
      projectTitle,
      totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
      signerName,
      signerEmail,
      place: protocolPlace,
      signedAt,
      signerIp,
      signerUserAgent,
      signedOfferSha256: signedPdfSha256,
    });
    const confirmationTitle = buildConfirmationPlanningFileTitle(orderId);
    const confirmation = await persistGeneratedPlanningPdfByTitle({
      db,
      companyId: safeString(planning.companyId),
      planningId: String(planning._id),
      category: "auftrag",
      title: confirmationTitle,
      buffer: confirmationPdf,
      customerId: safeString(planning.customerId) || undefined,
      session: systemSession,
    });
    const result = await db.collection<any>("plannings").updateOne(
      { _id: planning._id, offerSignatureTokenHash: tokenHash, offerSignatureProcessingId: processingId },
      {
        $set: {
          offerSignatureStatus: "signed",
          offerSignedAt: signedAt,
          offerSignerName: signerName,
          offerSignerEmail: signerEmail,
          offerSignerIp: signerIp,
          offerSignerUserAgent: signerUserAgent,
          offerSignaturePlace: place,
          offerSignaturePlaceName: placeName || null,
          offerSignatureImage: safeString(signatureImage),
          offerSignedPdfFileId: signedOfferFile._id,
          offerConfirmationPdfFileId: confirmation.doc._id,
          offerSignedPdfSha256: signedPdfSha256,
          orderSnapshotFileId: confirmation.doc._id,
          angebotSnapshotFileId: signedOfferSnapshot.doc._id,
          withdrawalRightApplies,
          withdrawalUntil,
          offerVollmachtTokenExpiresAt,
          subsidyPayoutAccountHolder: bankAccountHolder || null,
          subsidyPayoutIban: bankIban || null,
          propertyStreet,
          propertyHouseNumber,
          propertyZip,
          propertyCity,
          buildingNumber,
          egid: buildingNumber,
          buildingNumberSource,
          parcelNumber,
          parcelNumberSource,
          "data.profile.buildingStreet": propertyStreet,
          "data.profile.buildingStreetNo": propertyHouseNumber,
          "data.profile.buildingZip": propertyZip,
          "data.profile.buildingCity": propertyCity,
          "data.profile.buildingNumber": buildingNumber,
          "data.profile.egid": buildingNumber,
          "data.profile.buildingNumberSource": buildingNumberSource,
          "data.profile.parcelNumber": parcelNumber,
          "data.profile.parcelNumberSource": parcelNumberSource,
          offerSignatureProcessingId: null,
          offerSignatureProcessingAt: null,
          updatedAt: signedAt,
        },
        $push: {
          offerSignatureAudit: buildOfferAuditEntry({
            event: "signed",
            req,
            tokenHash,
            at: signedAt,
            meta: {
              signerName,
              signerEmail,
              place,
              placeName: placeName || null,
              viewedAt: planning.offerSignatureViewedAt ?? null,
              snapshotSha256: snapshot.hash,
              signedPdfSha256,
              orderId,
            },
          }) as never,
        },
      },
    );
    if (!result.matchedCount) throw new Error("Signaturstatus konnte nicht abgeschlossen werden.");
    const customerId = toObjectIdOrNull(planning?.customerId);
    if (
      propertyStreet || propertyHouseNumber || propertyZip || propertyCity ||
      buildingNumber || parcelNumber || bankAccountHolder || bankIban
    ) {
      await db.collection("auftraege").updateOne(
        {
          companyId: { $in: buildIdVariants(safeString(planning.companyId)) },
          orderId,
        },
        {
          $set: {
            subsidyPayoutAccountHolder: bankAccountHolder || null,
            subsidyPayoutIban: bankIban || null,
            propertyStreet,
            propertyHouseNumber,
            propertyZip,
            propertyCity,
            buildingNumber,
            egid: buildingNumber,
            buildingNumberSource,
            parcelNumber,
            parcelNumberSource,
            updatedAt: new Date(),
          },
        },
      ).catch((error) => console.error("STORE ORDER PAYOUT ACCOUNT ERROR:", error));
    }
    if (
      customerId &&
      (bankAccountHolder || bankIban)
    ) {
      const customerPayoutUpdatedAt = new Date();
      await db.collection("customers").updateOne(
        {
          _id: customerId,
          companyId: { $in: buildIdVariants(safeString(planning.companyId)) },
        },
        {
          $set: buildSignatureCustomerPayoutUpdate({
            accountHolder: bankAccountHolder || null,
            iban: bankIban || null,
            updatedAt: customerPayoutUpdatedAt,
          }),
        },
      ).catch((error) => console.error("STORE CUSTOMER PAYOUT ACCOUNT ERROR:", error));
    }
    const completed = await db.collection("plannings").findOne({ _id: planning._id });
    await emitCompanyRealtimeEvent(safeString(planning?.companyId), "offer.signed", {
      planningId: String(planning._id),
      orderId,
      signedAt: signedAt.toISOString(),
    });
    if (completed) {
      await deliverOfferAcceptedEmail({
        db,
        planning: completed,
        token,
        req,
        attachmentBuffer: confirmationPdf,
      });
    }
    return response(origin, signedResult(req, completed, token));
  } catch (error: any) {
    if (claimedPlanningId && processingId) {
      const db = await getDb().catch(() => null);
      await db?.collection("plannings").updateOne(
        { _id: claimedPlanningId, offerSignatureProcessingId: processingId },
        { $set: { offerSignatureProcessingId: null, offerSignatureProcessingAt: null } },
      ).catch(() => undefined);
    }
    const message = safeString(error?.message) || "Offerte konnte nicht unterschrieben werden.";
    const status = /PNG|2 MB|Name|E-Mail|Bedingungen|IBAN|maximal|Zeichen/.test(message) ? 400 : /bereits|nicht gefunden|nicht gespeichert/.test(message) ? 409 : 500;
    if (status === 500) console.error("PUBLIC OFFER SIGN ERROR:", error);
    return response(origin, { ok: false, message }, status);
  }
}
