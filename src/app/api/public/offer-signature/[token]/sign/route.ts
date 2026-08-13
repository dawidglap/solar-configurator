import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString, toObjectIdOrNull } from "@/lib/api-session";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  appendOfferConfirmationSignatureProtocol,
  createOfferConfirmationPdf,
  createSignedOrderPdf,
  extractRequestIp,
  getPublicApiBaseUrl,
  loadPlanningCustomer,
  normalizeSignaturePayments,
  resolveCustomerName,
  sha256,
  storeGeneratedSignatureFile,
  validateSignatureImage,
} from "@/lib/orderSignatures";
import {
  OFFER_VOLLMACHT_VALIDITY_MS,
  buildInternalOrderSession,
  buildOfferAuditEntry,
  buildSignedSessionCookie,
  enforceOfferPublicRateLimit,
  ensureActiveOfferToken,
  ensureOfferSignatureIndexes,
  findOfferByToken,
  getOfferSnapshot,
  normalizeOfferSignaturePlace,
  parseOfferAcceptanceDetails,
} from "@/lib/offerSignatures";
import {
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";
import { POST as generateOrder } from "@/app/api/plannings/[planningId]/generate-order/route";
import { buildIdVariants } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const response = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }

function signedResult(req: Request, planning: any, token: string) {
  const base = getPublicApiBaseUrl(req);
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
    if (planning.offerSignatureStatus === "signed") return response(origin, signedResult(req, planning, token));
    planning = await ensureActiveOfferToken(db, planning);
    if (!planning || !["sent", "viewed"].includes(planning.offerSignatureStatus)) return response(origin, { ok: false, message: "Offerte kann mit diesem Link nicht unterschrieben werden." }, 409);

    const body = await req.json().catch(() => ({}));
    if (body?.acceptedTerms !== true) return response(origin, { ok: false, message: "Die Bedingungen müssen akzeptiert werden." }, 400);
    const signerName = safeString(body?.signerName).slice(0, 200);
    const signerEmail = safeString(body?.signerEmail).toLowerCase().slice(0, 320);
    const placeName = safeString(body?.placeName);
    const place = normalizeOfferSignaturePlace(body?.place);
    const acceptance = parseOfferAcceptanceDetails(body);
    const bankAccountHolder = acceptance.bankAccountHolder;
    const bankIban = acceptance.bankIban;
    if (!signerName) return response(origin, { ok: false, message: "Name ist erforderlich." }, 400);
    if (!EMAIL_PATTERN.test(signerEmail)) return response(origin, { ok: false, message: "Ungültige E-Mail-Adresse." }, 400);
    const signaturePng = validateSignatureImage(body?.signatureImage);

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
    const customer = await loadPlanningCustomer(db, planning);
    const profile = planning?.data?.profile ?? {};
    const propertyStreet =
      acceptance.propertyStreet || safeString(profile?.buildingStreet) || safeString(customer?.buildingStreet) || null;
    const propertyHouseNumber =
      acceptance.propertyHouseNumber || safeString(profile?.buildingStreetNo) || safeString(customer?.buildingStreetNo) || null;
    const propertyZip =
      acceptance.propertyZip || safeString(profile?.buildingZip) || safeString(customer?.buildingZip) || null;
    const propertyCity =
      acceptance.propertyCity || safeString(profile?.buildingCity) || safeString(customer?.buildingCity) || null;
    const buildingNumber =
      acceptance.buildingNumber ||
      safeString(profile?.buildingNumber ?? profile?.egid) ||
      safeString(customer?.buildingNumber ?? customer?.egid) ||
      null;
    const parcelNumber =
      acceptance.parcelNumber || safeString(profile?.parcelNumber) || safeString(customer?.parcelNumber) || null;
    const landRegisterNumber =
      safeString(planning?.landRegisterNumber) ||
      safeString(profile?.landRegisterNumber) ||
      safeString(customer?.landRegisterNumber) ||
      null;
    const buildingNumberSource = acceptance.buildingNumber
      ? "manual"
      : safeString(profile?.buildingNumberSource ?? customer?.buildingNumberSource) === "manual"
        ? "manual"
        : "auto";
    const parcelNumberSource = acceptance.parcelNumber
      ? "manual"
      : safeString(profile?.parcelNumberSource ?? customer?.parcelNumberSource) === "manual"
        ? "manual"
        : "auto";
    const commercial = await computePlanningCommercialSummary(db, planning);
    const signedAt = new Date();
    const offerVollmachtTokenExpiresAt = new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS);
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
      totalInklMwst: Number(commercial?.totalInvestmentChf ?? 0),
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
    const payments = normalizeSignaturePayments(planning, Number(commercial?.totalInvestmentChf ?? 0));
    const confirmationBasePdf = await createOfferConfirmationPdf({
      sourcePdf: orderPdf,
      orderId,
      offerNumber,
      customerName,
      projectTitle,
      signerName,
      signedAt,
      totalInklMwst: Number(commercial?.totalInvestmentChf ?? 0),
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
      totalInklMwst: Number(commercial?.totalInvestmentChf ?? 0),
      signerName,
      signerEmail,
      place: protocolPlace,
      signedAt,
      signerIp,
      signerUserAgent,
      signedOfferSha256: signedPdfSha256,
    });
    const confirmation = await upsertManagedPlanningFile({
      db,
      companyId: safeString(planning.companyId),
      planningId: String(planning._id),
      category: "auftrag",
      title: `Auftragsbestätigung ${orderId}`,
      originalFileName: `auftragsbestaetigung-${orderId}.pdf`,
      mimeType: "application/pdf",
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
          offerSignatureImage: safeString(body?.signatureImage),
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
      (propertyStreet || propertyHouseNumber || propertyZip || propertyCity ||
        buildingNumber || parcelNumber || bankAccountHolder || bankIban)
    ) {
      await db.collection("customers").updateOne(
        {
          _id: customerId,
          companyId: { $in: buildIdVariants(safeString(planning.companyId)) },
        },
        {
          $set: {
            subsidyPayoutAccountHolder: bankAccountHolder || null,
            subsidyPayoutIban: bankIban || null,
            buildingStreet: propertyStreet,
            buildingStreetNo: propertyHouseNumber,
            buildingZip: propertyZip,
            buildingCity: propertyCity,
            buildingNumber,
            egid: buildingNumber,
            buildingNumberSource,
            parcelNumber,
            parcelNumberSource,
            updatedAt: new Date(),
          },
        },
      ).catch((error) => console.error("STORE CUSTOMER PAYOUT ACCOUNT ERROR:", error));
    }
    const completed = await db.collection("plannings").findOne({ _id: planning._id });
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
