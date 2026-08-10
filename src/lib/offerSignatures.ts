import crypto from "node:crypto";
import type { Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import {
  buildPlanningDocumentPdf,
  computePlanningCommercialSummary,
  resolveReportSections,
} from "@/lib/planningDocuments";
import {
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
} from "@/lib/planningFiles";
import {
  buildContentDispositionInline,
  buildSignatureRequester,
  enforceSignatureRateLimit,
  extractRequestIp,
  getPublicApiBaseUrl,
  loadPlanningCustomer,
  normalizeSignaturePayments,
  resolveCustomerEmail,
  resolveCustomerName,
  resolveObjectAddress,
  sha256,
  storeGeneratedSignatureFile,
} from "@/lib/orderSignatures";
import { downloadCompanyDocumentBuffer } from "@/lib/companyDocuments";

export const OFFER_SIGNATURE_STATUSES = [
  "none",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
] as const;
export const OFFER_SIGNATURE_PLACES = ["remote", "onsite_customer", "onsite_company"] as const;
export type OfferSignatureStatus = (typeof OFFER_SIGNATURE_STATUSES)[number];
export type OfferSignaturePlace = (typeof OFFER_SIGNATURE_PLACES)[number];

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let indexPromise: Promise<void> | null = null;

function iso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = safeString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeOfferSignatureStatus(value: unknown): OfferSignatureStatus {
  const status = safeString(value).toLowerCase() as OfferSignatureStatus;
  return OFFER_SIGNATURE_STATUSES.includes(status) ? status : "none";
}

export function normalizeOfferSignaturePlace(value: unknown): OfferSignaturePlace | null {
  const place = safeString(value).toLowerCase() as OfferSignaturePlace;
  return OFFER_SIGNATURE_PLACES.includes(place) ? place : null;
}

export function buildDefaultOfferSignatureFields() {
  return {
    offerSignatureStatus: "none" as const,
    offerSignatureTokenHash: null,
    offerSignatureTokenExpiresAt: null,
    offerSignatureRequestedAt: null,
    offerSignatureRequestedByUserId: null,
    offerSignatureRequestedByName: null,
    offerSignatureSentToEmail: null,
    offerSignatureViewedAt: null,
    offerSignedAt: null,
    offerSignerName: null,
    offerSignerEmail: null,
    offerSignerIp: null,
    offerSignerUserAgent: null,
    offerSignaturePlace: null,
    offerSignaturePlaceName: null,
    offerSignatureImage: null,
    offerSignatureDeclinedReason: null,
    offerSignedPdfFileId: null,
    offerSignedPdfSha256: null,
    offerConfirmationPdfFileId: null,
    withdrawalRightApplies: false,
    withdrawalUntil: null,
    offerSnapshotFileId: null,
    offerSignatureAudit: [],
    offerSignatureProcessingId: null,
    offerSignatureProcessingAt: null,
  };
}

export function normalizeOfferSignatureFields(planning: any) {
  return {
    offerSignatureStatus: normalizeOfferSignatureStatus(planning?.offerSignatureStatus),
    offerSignedAt: iso(planning?.offerSignedAt),
  };
}

export function buildOfferSignatureResponse(planning: any) {
  const planningId = mongoIdToString(planning?._id);
  const signedFileId = mongoIdToString(planning?.offerSignedPdfFileId) || safeString(planning?.offerSignedPdfFileId);
  const confirmationFileId =
    mongoIdToString(planning?.offerConfirmationPdfFileId) || safeString(planning?.offerConfirmationPdfFileId);
  return {
    signatureStatus: normalizeOfferSignatureStatus(planning?.offerSignatureStatus),
    signatureRequestedAt: iso(planning?.offerSignatureRequestedAt),
    signatureRequestedByName: safeString(planning?.offerSignatureRequestedByName) || null,
    signatureSentToEmail: safeString(planning?.offerSignatureSentToEmail) || null,
    signatureTokenExpiresAt: iso(planning?.offerSignatureTokenExpiresAt),
    signatureViewedAt: iso(planning?.offerSignatureViewedAt),
    signedAt: iso(planning?.offerSignedAt),
    signerName: safeString(planning?.offerSignerName) || null,
    signerEmail: safeString(planning?.offerSignerEmail) || null,
    signatureDeclinedReason: safeString(planning?.offerSignatureDeclinedReason) || null,
    signatureLink: null,
    signedPdfUrl:
      planningId && signedFileId
        ? `/api/plannings/${planningId}/files/${signedFileId}/download`
        : null,
    confirmationPdfUrl:
      planningId && confirmationFileId
        ? `/api/plannings/${planningId}/files/${confirmationFileId}/download`
        : null,
    orderId: safeString(planning?.orderId) || null,
    signaturePlace: normalizeOfferSignaturePlace(planning?.offerSignaturePlace),
    withdrawalRightApplies: planning?.withdrawalRightApplies === true,
    withdrawalUntil: iso(planning?.withdrawalUntil),
  };
}

export function buildOfferSignatureLink(token: string) {
  const origin = (safeString(process.env.APP_ORIGIN) || safeString(process.env.APP_BASE_URL) || "https://app.helionic.ch").replace(/\/+$/, "");
  return `${origin}/angebot-signieren/${encodeURIComponent(token)}`;
}

export function parseOfferSignatureRequest(body: any) {
  const email = safeString(body?.email).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("Ungültige E-Mail-Adresse.");
  const expiresInDays = Number(body?.expiresInDays ?? 30);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
    throw new Error("expiresInDays muss eine ganze Zahl zwischen 1 und 90 sein.");
  }
  const place = normalizeOfferSignaturePlace(body?.place);
  if (!place) throw new Error("Ungültiger Abschlussort.");
  return {
    email,
    message: safeString(body?.message).slice(0, 4000),
    expiresInDays,
    sendEmail: body?.sendEmail === true,
    place,
  };
}

export function newOfferSignatureToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function buildOfferAuditEntry(args: {
  event: string;
  req?: Request;
  tokenHash?: string;
  at?: Date;
  meta?: Record<string, unknown>;
}) {
  return {
    at: args.at ?? new Date(),
    event: safeString(args.event),
    ip: args.req ? extractRequestIp(args.req) : "",
    userAgent: args.req ? safeString(args.req.headers.get("user-agent")).slice(0, 1000) : "",
    tokenId: safeString(args.tokenHash),
    meta: args.meta ?? {},
  };
}

export async function ensureOfferSignatureIndexes(db: Db) {
  if (indexPromise) return indexPromise;
  indexPromise = Promise.all([
    db.collection("plannings").createIndex(
      { offerSignatureTokenHash: 1 },
      {
        unique: true,
        partialFilterExpression: { offerSignatureTokenHash: { $type: "string" } },
        name: "unique_offer_signature_token_hash",
      },
    ),
    db.collection("plannings").createIndex({ offerSignatureStatus: 1, offerSignatureTokenExpiresAt: 1 }),
  ]).then(() => undefined).catch((error) => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
}

export async function enforceOfferPublicRateLimit(db: Db, req: Request) {
  return enforceSignatureRateLimit({
    db,
    scope: "public-offer-ip",
    subject: extractRequestIp(req),
    limit: 30,
    windowMs: 60_000,
  });
}

export function isValidOfferToken(token: unknown) {
  return TOKEN_PATTERN.test(safeString(token));
}

export async function findOfferByToken(db: Db, token: string): Promise<any | null> {
  if (!isValidOfferToken(token)) return null;
  return db.collection("plannings").findOne({
    offerSignatureTokenHash: sha256(token),
    offerSignatureStatus: { $in: ["sent", "viewed", "signed"] },
  });
}

export async function ensureActiveOfferToken(db: Db, planning: any) {
  const status = normalizeOfferSignatureStatus(planning?.offerSignatureStatus);
  if (status === "signed") return planning;
  const expires = planning?.offerSignatureTokenExpiresAt
    ? new Date(planning.offerSignatureTokenExpiresAt)
    : null;
  if (
    ["sent", "viewed"].includes(status) &&
    expires &&
    !Number.isNaN(expires.getTime()) &&
    expires.getTime() > Date.now()
  ) return planning;
  await db.collection<any>("plannings").updateOne(
    { _id: planning._id, offerSignatureStatus: { $in: ["sent", "viewed"] } },
    {
      $set: {
        offerSignatureStatus: "expired",
        offerSignatureTokenHash: null,
        updatedAt: new Date(),
      },
      $push: { offerSignatureAudit: buildOfferAuditEntry({ event: "expired" }) as never },
    },
  );
  return null;
}

export async function buildAndStoreOfferSnapshot(args: {
  db: Db;
  planning: any;
  company: any;
  session: SessionPayload;
}) {
  const planningId = mongoIdToString(args.planning?._id);
  const companyId = safeString(args.planning?.companyId);
  const files = getPlanningFilesCollection(args.db);
  const current = await files.findOne(
    {
      companyId,
      planningId,
      isDeleted: { $ne: true },
      mimeType: "application/pdf",
      $or: [{ category: "offer" }, { type: "angebot" }],
    },
    { sort: { createdAt: -1, _id: -1 } },
  );
  const buffer = current
    ? await fetchPlanningFileBuffer(current)
    : (
        await buildPlanningDocumentPdf({
          db: args.db,
          planning: args.planning,
          company: args.company,
          session: args.session,
          documentType: "angebot",
          sections: resolveReportSections(args.planning),
        })
      ).pdfBytes;
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Offerten-PDF ist ungültig.");
  }
  const file = await storeGeneratedSignatureFile({
    db: args.db,
    planning: args.planning,
    category: "offer_snapshot",
    title: `Offerten-Snapshot ${safeString(args.planning?.planningNumber)}`,
    fileName: `offerte-${safeString(args.planning?.planningNumber) || planningId}-snapshot.pdf`,
    mimeType: "application/pdf",
    buffer,
    actorName: safeString(args.session?.name) || "System",
  });
  return { file, buffer, hash: sha256(buffer) };
}

export async function getOfferSnapshot(db: Db, planning: any) {
  const fileId = toObjectIdOrNull(planning?.offerSnapshotFileId);
  if (!fileId) throw new Error("Offerten-Snapshot nicht gefunden.");
  const file = await getPlanningFilesCollection(db).findOne({
    _id: fileId,
    companyId: safeString(planning?.companyId),
    planningId: mongoIdToString(planning?._id),
    category: "offer_snapshot",
    isDeleted: { $ne: true },
  });
  if (!file) throw new Error("Offerten-Snapshot nicht gefunden.");
  const buffer = await fetchPlanningFileBuffer(file);
  return { file, buffer, hash: sha256(buffer) };
}

export async function getOfferPublicFile(db: Db, planning: any, kind: string) {
  const field =
    kind === "signed"
      ? "offerSignedPdfFileId"
      : kind === "confirmation"
        ? "offerConfirmationPdfFileId"
        : "offerSnapshotFileId";
  const fileId = toObjectIdOrNull(planning?.[field]);
  if (!fileId) return null;
  const file = await getPlanningFilesCollection(db).findOne({
    _id: fileId,
    companyId: safeString(planning?.companyId),
    planningId: mongoIdToString(planning?._id),
    isDeleted: { $ne: true },
  });
  if (!file) return null;
  return { file, buffer: await fetchPlanningFileBuffer(file) };
}

export function buildPublicOfferCustomerFields(planning: any, customer: any) {
  const profile = planning?.data?.profile ?? {};
  const rawCustomerType = safeString(profile?.customerType ?? profile?.type ?? customer?.type).toLowerCase();
  const customerType = rawCustomerType === "company" || rawCustomerType === "firma"
    ? "company"
    : "private";
  const rawSalutation = safeString(
    profile?.contactSalutation ?? profile?.salutation ?? profile?.gender ?? customer?.salutation,
  ).toLowerCase();
  const salutation = customerType === "company"
    ? "firma"
    : ["herr", "mr", "male", "mann", "m"].includes(rawSalutation)
      ? "herr"
      : ["frau", "mrs", "ms", "female", "weiblich", "w"].includes(rawSalutation)
        ? "frau"
        : null;
  return {
    salutation,
    customerLastName:
      safeString(profile?.contactLastName ?? profile?.lastName) ||
      safeString(customer?.lastName),
    customerType,
    customerCompanyName:
      safeString(profile?.businessName ?? profile?.companyName) ||
      safeString(customer?.companyName) ||
      null,
    addressStreet:
      safeString(profile?.buildingStreet) || safeString(customer?.buildingStreet) || null,
    addressHouseNumber:
      safeString(profile?.buildingStreetNo) || safeString(customer?.buildingStreetNo) || null,
    addressZip:
      safeString(profile?.buildingZip) || safeString(customer?.buildingZip) || null,
    addressCity:
      safeString(profile?.buildingCity) || safeString(customer?.buildingCity) || null,
    egid: safeString(profile?.egid) || safeString(customer?.egid) || null,
    buildingNumber:
      safeString(profile?.buildingNumber ?? profile?.egid) ||
      safeString(customer?.buildingNumber ?? customer?.egid) ||
      null,
    parcelNumber:
      safeString(profile?.parcelNumber) || safeString(customer?.parcelNumber) || null,
  };
}

export async function buildPublicOffer(args: { db: Db; planning: any; token: string; req: Request }) {
  const companyId = safeString(args.planning?.companyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const [company, customer, commercial, terms] = await Promise.all([
    companyObjectId ? args.db.collection("companies").findOne({ _id: companyObjectId }) : null,
    loadPlanningCustomer(args.db, args.planning),
    computePlanningCommercialSummary(args.db, args.planning),
    downloadCompanyDocumentBuffer(args.db, companyId, "agb").catch(() => null),
  ]);
  const status = normalizeOfferSignatureStatus(args.planning?.offerSignatureStatus);
  const base = getPublicApiBaseUrl(args.req);
  const requestedAt = args.planning?.offerSignatureRequestedAt
    ? new Date(args.planning.offerSignatureRequestedAt)
    : new Date();
  const validUntil = new Date(requestedAt.getTime() + 30 * 86_400_000);
  return {
    offerNumber: safeString(args.planning?.planningNumber),
    planningId: mongoIdToString(args.planning?._id),
    companyName: safeString(company?.name),
    companyLogoUrl: safeString(company?.branding?.logoUrl),
    customerName: resolveCustomerName(args.planning, customer),
    customerEmail: resolveCustomerEmail(args.planning, customer),
    ...buildPublicOfferCustomerFields(args.planning, customer),
    projectTitle: safeString(args.planning?.title) || safeString(args.planning?.planningNumber),
    objectAddress: resolveObjectAddress(args.planning),
    totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
    subsidyChf: Number(commercial?.subsidyChf ?? 0),
    effectiveCostChf: Number(commercial?.effectiveCostChf ?? 0),
    paymentTerms:
      safeString(args.planning?.data?.reportOptions?.paymentTerms) ||
      safeString(args.planning?.data?.reportOptions?.zahlungsbedingungen),
    payments: normalizeSignaturePayments(args.planning, Number(commercial?.grossPriceChf ?? 0)),
    validUntil: validUntil.toISOString(),
    pdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf`,
    termsUrl: terms
      ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/terms`
      : null,
    status,
    expiresAt: iso(args.planning?.offerSignatureTokenExpiresAt),
    signedAt: iso(args.planning?.offerSignedAt),
    signedPdfUrl:
      status === "signed"
        ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf?type=signed`
        : null,
    confirmationPdfUrl:
      status === "signed"
        ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf?type=confirmation`
        : null,
    orderId: safeString(args.planning?.orderId) || null,
  };
}

export function buildInternalOrderSession(planning: any, signerName: string): SessionPayload {
  const requester = buildSignatureRequester({
    activeCompanyId: safeString(planning?.companyId),
    userId: mongoIdToString(planning?.offerSignatureRequestedByUserId),
    name: safeString(planning?.offerSignatureRequestedByName),
  });
  return {
    activeCompanyId: safeString(planning?.companyId),
    userId: mongoIdToString(requester.id) || safeString(requester.id),
    name: safeString(signerName) || requester.name || "Offer Signature",
    activeRole: "owner",
  };
}

export function buildSignedSessionCookie(session: SessionPayload, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `session=${payload}.${signature}`;
}

export { buildContentDispositionInline };
