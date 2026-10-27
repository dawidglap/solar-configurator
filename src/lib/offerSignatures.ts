import crypto from "node:crypto";
import type { Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import {
  buildPlanningDocumentPdf,
  computePlanningCommercialSummary,
  resolveHeatingDocumentCustomer,
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
  validateSignatureImage,
} from "@/lib/orderSignatures";
import { downloadCompanyDocumentBuffer } from "@/lib/companyDocuments";
import { isValidIban, normalizeIban } from "@/lib/swissQrBill";
import { resolvePlanningSellerContact } from "@/lib/userProfiles";
import { derivePlanningBadgeFields } from "@/lib/statusBadges";
import { resolveProjectType } from "@/lib/projectType";

export const OFFER_SIGNATURE_STATUSES = [
  "none",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
] as const;
export const OFFER_VOLLMACHT_VALIDITY_MS = 30 * 86_400_000;
export const MAX_VOLLMACHT_REQUEST_DAYS = 90;
export type OfferSignatureStatus = (typeof OFFER_SIGNATURE_STATUSES)[number];

export type HeatingOfferIssuedSnapshot = {
  schemaVersion: 1;
  projectType: "heating";
  planningId: string;
  offerNumber: string;
  documentTitle: "Heizungsangebot";
  issuedAt: string;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    salutation: string | null;
    lastName: string | null;
    type: "private" | "company";
    companyName: string | null;
    address: {
      street: string | null;
      houseNumber: string | null;
      zip: string | null;
      city: string | null;
    };
  };
  objectAddress: {
    formatted: string;
    street: string | null;
    houseNumber: string | null;
    zip: string | null;
    city: string | null;
  };
  items: Array<Record<string, unknown>>;
  optionalItems: Array<Record<string, unknown>>;
  pricing: {
    subtotalNet: number;
    discount: {
      fixedChf: number;
      percent: number;
      percentAmountChf: number;
      totalChf: number;
    };
    netAfterDiscount: number;
    vatRate: number;
    vatAmount: number;
    totalGross: number;
  };
  paymentTerms: string;
  payments: Array<{ label: string; pct: number; amount: number; dueDate: string | null }>;
  skonto: { percent: number; days: number };
  validity: { validUntil: string };
  pdfFileId: string;
  pdfSha256: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_VOLLMACHT_SIGNATURE_METHOD =
  "Einfache elektronische Signatur (EES) - online, getippt";
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

export function normalizeOfferSignaturePlace(value: unknown) {
  return safeString(value) || "remote";
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
    offerSignaturePlace: "remote",
    offerSignaturePlaceName: null,
    offerSignatureImage: null,
    offerSignatureDeclinedReason: null,
    offerSignedPdfFileId: null,
    offerSignedPdfSha256: null,
    offerConfirmationPdfFileId: null,
    offerVollmachtPdfFileId: null,
    withdrawalRightApplies: false,
    withdrawalUntil: null,
    offerSnapshotFileId: null,
    heatingOfferIssuedSnapshot: null,
    offerSignatureAudit: [],
    offerSignatureProcessingId: null,
    offerSignatureProcessingAt: null,
    offerVollmachtTokenExpiresAt: null,
    vollmachtRequestTokenHash: null,
    vollmachtRequestTokenExpiresAt: null,
    vollmachtRequestTokenCiphertext: null,
    vollmachtManuallyActivated: false,
    vollmachtSignatureRequired: true,
    vollmachtRequestedAt: null,
    vollmachtRequestedByUserId: null,
    vollmachtRequestedByName: null,
    vollmachtRequestAudit: [],
    vollmachtSubmittedAt: null,
    vollmachtSignedAt: null,
    vollmachtSignatureImageFileId: null,
    vollmachtSignature: null,
    vollmachtParcelNumber: null,
    vollmachtLandRegisterNumber: null,
    vollmachtBuildingNumber: null,
    vollmachtBankName: null,
    vollmachtOwnerCompanyName: null,
    vollmachtOwnerBirthDate: null,
    vollmachtOwnerPhone: null,
    vollmachtOwnerEmail: null,
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
  const vollmachtFileId =
    mongoIdToString(planning?.offerVollmachtPdfFileId) || safeString(planning?.offerVollmachtPdfFileId);
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
    vollmachtPdfUrl:
      planningId && vollmachtFileId
        ? `/api/plannings/${planningId}/files/${vollmachtFileId}/download`
        : null,
    orderId: safeString(planning?.orderId) || null,
    signaturePlace: normalizeOfferSignaturePlace(planning?.offerSignaturePlace),
    withdrawalRightApplies: planning?.withdrawalRightApplies === true,
    ...derivePlanningBadgeFields(planning),
  };
}

export function buildOfferSignatureLink(token: string) {
  const origin = (safeString(process.env.APP_ORIGIN) || safeString(process.env.APP_BASE_URL) || "https://app.helionic.ch").replace(/\/+$/, "");
  return `${origin}/angebot-signieren/${encodeURIComponent(token)}`;
}

export function buildOfferVollmachtLink(token: string) {
  const origin = (
    safeString(process.env.APP_ORIGIN) ||
    safeString(process.env.APP_BASE_URL) ||
    "https://app.helionic.ch"
  ).replace(/\/+$/, "");
  return `${origin}/vollmacht/${encodeURIComponent(token)}`;
}

export function buildManualVollmachtLink(token: string) {
  return `${buildOfferVollmachtLink(token)}?modus=formular`;
}

export function parseVollmachtRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Ungültige Eingabe.");
  }
  const input = body as Record<string, unknown>;
  const expiresInDays = Number(input.expiresInDays ?? 30);
  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > MAX_VOLLMACHT_REQUEST_DAYS
  ) {
    throw new Error(
      `expiresInDays muss eine ganze Zahl zwischen 1 und ${MAX_VOLLMACHT_REQUEST_DAYS} sein.`,
    );
  }
  if (input.signatureRequired !== undefined && typeof input.signatureRequired !== "boolean") {
    throw new Error("signatureRequired muss ein Boolean sein.");
  }
  return {
    expiresInDays,
    signatureRequired: input.signatureRequired === true,
  };
}

function vollmachtTokenEncryptionKey(secret: string) {
  return crypto
    .createHash("sha256")
    .update(`helionic-vollmacht-request-token:v1\0${secret}`)
    .digest();
}

export function encryptVollmachtRequestToken(token: string, secret: string) {
  if (!isValidOfferToken(token) || !safeString(secret)) {
    throw new Error("Vollmacht-Token kann nicht verschlüsselt werden.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vollmachtTokenEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptVollmachtRequestToken(value: unknown, secret: string) {
  const [version, ivValue, tagValue, encryptedValue] = safeString(value).split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue || !safeString(secret)) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vollmachtTokenEncryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const token = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return isValidOfferToken(token) ? token : null;
  } catch {
    return null;
  }
}

export function parseOfferSignatureRequest(body: any) {
  const email = safeString(body?.email).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("Ungültige E-Mail-Adresse.");
  const expiresInDays = Number(body?.expiresInDays ?? 30);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
    throw new Error("expiresInDays muss eine ganze Zahl zwischen 1 und 90 sein.");
  }
  const place = normalizeOfferSignaturePlace(body?.place);
  return {
    email,
    message: safeString(body?.message).slice(0, 4000),
    expiresInDays,
    sendEmail: body?.sendEmail === true,
    place,
  };
}

function optionalLimitedString(value: unknown, label: string, maxLength: number) {
  const normalized = safeString(value);
  if (normalized.length > maxLength) {
    throw new Error(`${label} darf maximal ${maxLength} Zeichen lang sein.`);
  }
  return normalized || null;
}

function requiredLimitedString(value: unknown, label: string, maxLength: number) {
  const normalized = optionalLimitedString(value, label, maxLength);
  if (!normalized) throw new Error(`${label} ist erforderlich.`);
  return normalized;
}

function parseIsoLocalDate(value: unknown, label: string) {
  const normalized = requiredLimitedString(value, label, 10);
  if (!ISO_LOCAL_DATE_PATTERN.test(normalized)) {
    throw new Error(`${label} muss im Format YYYY-MM-DD angegeben werden.`);
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} ist ungültig.`);
  }
  return normalized;
}

export function isOfferVollmachtRequired(planning: any) {
  if (resolveProjectType(planning?.projectType) === "heating") return false;
  return planning?.vollmachtManuallyActivated === true ||
    planning?.data?.parts?.formDocuments?.vollmacht !== false;
}

export function parseOfferAcceptanceDetails(body: any) {
  const bankIban = normalizeIban(body?.bankIban) || null;
  if (bankIban && bankIban.length > 34) {
    throw new Error("IBAN darf maximal 34 Zeichen lang sein.");
  }
  if (bankIban && !isValidIban(bankIban)) {
    throw new Error("Ungültige IBAN.");
  }
  return {
    propertyStreet: optionalLimitedString(body?.propertyStreet, "Objektstrasse", 120),
    propertyHouseNumber: optionalLimitedString(body?.propertyHouseNumber, "Hausnummer", 20),
    propertyZip: optionalLimitedString(body?.propertyZip, "Postleitzahl", 12),
    propertyCity: optionalLimitedString(body?.propertyCity, "Ort", 100),
    buildingNumber: optionalLimitedString(body?.buildingNumber, "Gebäudenummer (EGID)", 30),
    parcelNumber: optionalLimitedString(body?.parcelNumber, "Grundstücknummer", 60),
    bankAccountHolder: optionalLimitedString(body?.bankAccountHolder, "Kontoinhaber", 200),
    bankIban,
  };
}

export function parseOfferVollmachtDetails(
  body: any,
  options: { signatureRequired?: boolean } = {},
) {
  const signatureRequired = options.signatureRequired !== false;
  const propertyStreet = optionalLimitedString(
    body?.propertyStreet ?? body?.street,
    "Objektstrasse",
    120,
  );
  const propertyZip = optionalLimitedString(body?.propertyZip ?? body?.zip, "Postleitzahl", 12);
  const propertyCity = optionalLimitedString(body?.propertyCity ?? body?.city, "Ort", 100);
  const parcelNumber = optionalLimitedString(body?.parcelNumber, "Parzelle", 60);
  const landRegisterNumber = optionalLimitedString(body?.landRegisterNumber, "Grundstücknummer", 60);
  const buildingNumber = optionalLimitedString(body?.buildingNumber, "Gebäude Nummer", 30);
  const bankAccountHolder = optionalLimitedString(body?.bankAccountHolder, "Kontoinhaber", 200);
  const bankName = optionalLimitedString(body?.bankName, "Bank", 200);
  const bankIban = normalizeIban(body?.bankIban) || null;
  if (!propertyStreet) throw new Error("Objektstrasse ist erforderlich.");
  if (!propertyZip) throw new Error("Postleitzahl ist erforderlich.");
  if (!propertyCity) throw new Error("Ort ist erforderlich.");
  if (!buildingNumber) throw new Error("Gebäude Nummer ist erforderlich.");
  if (!bankAccountHolder) throw new Error("Kontoinhaber ist erforderlich.");
  if (!bankName) throw new Error("Bank ist erforderlich.");
  if (!bankIban) throw new Error("IBAN ist erforderlich.");
  const ownerFirstName = optionalLimitedString(body?.ownerFirstName, "Vorname Eigentümer", 100);
  const ownerLastName = optionalLimitedString(body?.ownerLastName, "Nachname Eigentümer", 100);
  const ownerCompanyName = optionalLimitedString(body?.ownerCompanyName, "Firma Eigentümerschaft", 200);
  const ownerBirthDate = parseIsoLocalDate(body?.ownerBirthDate, "Geburtsdatum");
  const ownerPhone = requiredLimitedString(body?.ownerPhone, "Telefonnummer", 50);
  const ownerEmail = requiredLimitedString(body?.ownerEmail, "E-Mail-Adresse", 320).toLowerCase();
  if (!EMAIL_PATTERN.test(ownerEmail)) throw new Error("E-Mail-Adresse ist ungültig.");
  const signerFirstName = optionalLimitedString(body?.signerFirstName, "Vorname Unterzeichner", 100);
  const signerLastName = optionalLimitedString(body?.signerLastName, "Nachname Unterzeichner", 100);
  const explicitSignerName = optionalLimitedString(
    body?.signerName ?? body?.fullName,
    "Name Unterzeichner",
    200,
  );
  const ownerName = [ownerFirstName, ownerLastName].filter(Boolean).join(" ");
  const splitSignerName = [signerFirstName, signerLastName].filter(Boolean).join(" ");
  const signerName = ownerName || explicitSignerName || splitSignerName;
  const signaturePlace = safeString(body?.signaturePlace).slice(0, 120) || null;
  const signatureDate = safeString(body?.signatureDate)
    ? parseIsoLocalDate(body?.signatureDate, "Unterschriftsdatum")
    : signatureRequired
      ? parseIsoLocalDate(body?.signatureDate, "Unterschriftsdatum")
      : null;
  const signatureImage = safeString(body?.signatureImage);
  const signaturePng = signatureImage
    ? validateSignatureImage(signatureImage)
    : signatureRequired
      ? validateSignatureImage(signatureImage)
      : null;
  const signatureMethod = signaturePng
    ? optionalLimitedString(body?.signatureMethod, "Signaturmethode", 240) ||
      DEFAULT_VOLLMACHT_SIGNATURE_METHOD
    : null;
  if (!signerName) throw new Error("Name Unterzeichner ist erforderlich.");
  return {
    propertyStreet,
    propertyZip,
    propertyCity,
    parcelNumber,
    landRegisterNumber,
    buildingNumber,
    bankAccountHolder,
    bankName,
    bankIban,
    ownerCompanyName,
    ownerFirstName,
    ownerLastName,
    ownerBirthDate,
    ownerPhone,
    ownerEmail,
    signerFirstName,
    signerLastName,
    signerName,
    signaturePlace,
    signatureDate,
    signatureImage,
    signaturePng,
    signatureMethod,
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
    db.collection("plannings").createIndex(
      { vollmachtRequestTokenHash: 1 },
      {
        unique: true,
        partialFilterExpression: { vollmachtRequestTokenHash: { $type: "string" } },
        name: "unique_vollmacht_request_token_hash",
      },
    ),
    db.collection("plannings").createIndex({ vollmachtRequestTokenExpiresAt: 1 }),
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

function validDate(value: unknown) {
  const date = value instanceof Date ? value : safeString(value) ? new Date(safeString(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function getLegacyOfferVollmachtExpiresAt(planning: any) {
  const explicit = planning?.offerVollmachtTokenExpiresAt
    ? new Date(planning.offerVollmachtTokenExpiresAt)
    : null;
  if (explicit && !Number.isNaN(explicit.getTime())) return explicit;
  const signedAt = planning?.offerSignedAt ? new Date(planning.offerSignedAt) : null;
  if (!signedAt || Number.isNaN(signedAt.getTime())) return null;
  return new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS);
}

export type VollmachtTokenContext = {
  kind: "manual" | "offer";
  tokenHash: string;
  expiresAt: Date;
  signatureRequired: boolean;
};

export function resolveVollmachtTokenContext(
  planning: any,
  token: string,
  now = new Date(),
): VollmachtTokenContext | null {
  if (!isValidOfferToken(token)) return null;
  const tokenHash = sha256(token);
  if (
    planning?.vollmachtManuallyActivated === true &&
    safeString(planning?.vollmachtRequestTokenHash) === tokenHash
  ) {
    const expiresAt = validDate(planning?.vollmachtRequestTokenExpiresAt);
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      return {
        kind: "manual",
        tokenHash,
        expiresAt,
        signatureRequired: planning?.vollmachtSignatureRequired === true,
      };
    }
  }
  if (
    safeString(planning?.offerSignatureTokenHash) === tokenHash &&
    safeString(planning?.offerSignatureStatus) === "signed"
  ) {
    const expiresAt = getLegacyOfferVollmachtExpiresAt(planning);
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      return { kind: "offer", tokenHash, expiresAt, signatureRequired: true };
    }
  }
  return null;
}

export function getOfferVollmachtExpiresAt(planning: any, token?: string) {
  if (token) return resolveVollmachtTokenContext(planning, token, new Date(0))?.expiresAt ?? null;
  if (planning?.vollmachtManuallyActivated === true) {
    const manual = validDate(planning?.vollmachtRequestTokenExpiresAt);
    if (manual) return manual;
  }
  return getLegacyOfferVollmachtExpiresAt(planning);
}

export async function findOfferForVollmacht(
  db: Db,
  token: string,
  now = new Date(),
): Promise<any | null> {
  if (!isValidOfferToken(token)) return null;
  const tokenHash = sha256(token);
  const planning = await db.collection("plannings").findOne({
    $or: [
      { vollmachtRequestTokenHash: tokenHash, vollmachtManuallyActivated: true },
      { offerSignatureTokenHash: tokenHash, offerSignatureStatus: "signed" },
    ],
  });
  if (!planning) return null;
  return resolveVollmachtTokenContext(planning, token, now) ? planning : null;
}

export function buildOfferVollmachtResponse(args: {
  planning: any;
  company: any;
  customer: any;
  token: string;
  req: Request;
}) {
  const planning = args.planning;
  const address = resolveOfferPropertyAddress(planning, args.customer);
  const tokenContext = resolveVollmachtTokenContext(planning, args.token, new Date(0));
  const expiresAt = tokenContext?.expiresAt ?? getOfferVollmachtExpiresAt(planning);
  const submittedAt = iso(planning?.vollmachtSubmittedAt);
  const vollmachtRequired = isOfferVollmachtRequired(planning);
  const base = getPublicApiBaseUrl(args.req);
  const signature = planning?.vollmachtSignature ?? {};
  const legacySubmittedValue = (value: unknown) => submittedAt ? safeString(value) : "";
  return {
    vollmachtRequired,
    signatureRequired: tokenContext?.signatureRequired ?? true,
    submitted: !!submittedAt,
    submittedAt,
    expiresAt: expiresAt?.toISOString() ?? null,
    offerNumber: safeString(planning?.planningNumber),
    orderId: safeString(planning?.orderId) || null,
    companyName: safeString(args.company?.name),
    companyLogoUrl: safeString(args.company?.branding?.logoUrl) || null,
    ...buildPublicCompanyFields(args.company),
    customerName: resolveCustomerName(planning, args.customer),
    customerEmail: resolveCustomerEmail(planning, args.customer) || null,
    objectAddress: address.objectAddress,
    propertyStreet: address.propertyStreetLine,
    propertyZip: address.propertyZip,
    propertyCity: address.propertyCity,
    parcelNumber:
      safeString(planning?.vollmachtParcelNumber) ||
      safeString(signature?.parcelNumber) ||
      legacySubmittedValue(planning?.parcelNumber) ||
      null,
    landRegisterNumber:
      safeString(planning?.vollmachtLandRegisterNumber) ||
      safeString(signature?.landRegisterNumber) ||
      legacySubmittedValue(planning?.landRegisterNumber) ||
      null,
    buildingNumber:
      safeString(planning?.vollmachtBuildingNumber) ||
      safeString(signature?.buildingNumber) ||
      null,
    bankAccountHolder:
      safeString(planning?.subsidyPayoutAccountHolder) ||
      safeString(args.customer?.subsidyPayoutAccountHolder),
    bankIban:
      safeString(planning?.subsidyPayoutIban) ||
      safeString(args.customer?.subsidyPayoutIban),
    bankName:
      safeString(planning?.vollmachtBankName) ||
      safeString(signature?.bankName) ||
      null,
    ownerCompanyName:
      safeString(planning?.vollmachtOwnerCompanyName) ||
      safeString(signature?.ownerCompanyName) ||
      null,
    ownerFirstName:
      safeString(planning?.vollmachtOwnerFirstName) ||
      safeString(planning?.vollmachtSignature?.ownerFirstName) ||
      null,
    ownerLastName:
      safeString(planning?.vollmachtOwnerLastName) ||
      safeString(planning?.vollmachtSignature?.ownerLastName) ||
      null,
    ownerBirthDate:
      safeString(planning?.vollmachtOwnerBirthDate) ||
      safeString(signature?.ownerBirthDate) ||
      null,
    ownerPhone:
      safeString(planning?.vollmachtOwnerPhone) ||
      safeString(signature?.ownerPhone) ||
      null,
    ownerEmail:
      safeString(planning?.vollmachtOwnerEmail) ||
      safeString(signature?.ownerEmail) ||
      null,
    signerFirstName:
      safeString(planning?.vollmachtSignerFirstName) ||
      safeString(planning?.vollmachtSignature?.signerFirstName) ||
      null,
    signerLastName:
      safeString(planning?.vollmachtSignerLastName) ||
      safeString(planning?.vollmachtSignature?.signerLastName) ||
      null,
    signerName:
      safeString(planning?.vollmachtSignerName) ||
      safeString(planning?.vollmachtSignature?.signerName) ||
      null,
    signatureDate:
      safeString(planning?.vollmachtSignatureDate) ||
      safeString(planning?.vollmachtSignature?.signatureDate) ||
      null,
    signatureMethod:
      safeString(planning?.vollmachtSignatureMethod) ||
      safeString(planning?.vollmachtSignature?.signatureMethod) ||
      null,
    confirmationPdfUrl: planning?.offerConfirmationPdfFileId
      ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf?type=confirmation`
      : null,
    vollmachtPdfUrl: vollmachtRequired && planning?.offerVollmachtPdfFileId
      ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/vollmacht?download=1`
      : null,
  };
}

export function buildPublicCompanyFields(company: any) {
  return {
    companyStreet: safeString(company?.address?.street) || null,
    companyZip: safeString(company?.address?.zip) || null,
    companyCity: safeString(company?.address?.city) || null,
    companyUid: safeString(company?.uid) || null,
    companyPhone: safeString(company?.contact?.phone) || null,
    companyEmail: safeString(company?.contact?.email) || null,
    companyWebsite: safeString(company?.contact?.website) || null,
  };
}

export function resolvePublicCustomerPhone(planning: any, customer: any) {
  const profile = planning?.data?.profile ?? {};
  return (
    safeString(profile?.contactMobile) ||
    safeString(profile?.contactPhone) ||
    safeString(profile?.phone) ||
    safeString(profile?.mobile) ||
    safeString(profile?.businessPhone) ||
    safeString(customer?.phone) ||
    safeString(customer?.mobile) ||
    safeString(customer?.businessPhone) ||
    safeString(customer?.businessMobile) ||
    null
  );
}

function removeDuplicatePlace(street: string, place: string) {
  if (!street || !place) return street;
  let normalizedStreet = street.replace(/\s+/g, " ").trim();
  const normalizedPlace = place.replace(/\s+/g, " ").trim();
  const escaped = normalizedPlace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingPlace = new RegExp(`(?:,\\s*|\\s+)${escaped}$`, "i");
  while (trailingPlace.test(normalizedStreet)) {
    normalizedStreet = normalizedStreet.replace(trailingPlace, "").replace(/,\s*$/, "").trim();
  }
  const zip = normalizedPlace.match(/^\S+/)?.[0] ?? "";
  if (zip) {
    const escapedZip = zip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trailingZipPlace = new RegExp(`,\\s*${escapedZip}\\b[^,]*$`, "i");
    while (trailingZipPlace.test(normalizedStreet)) {
      normalizedStreet = normalizedStreet.replace(trailingZipPlace, "").replace(/,\s*$/, "").trim();
    }
  }
  return normalizedStreet;
}

export function splitOfferStreetAndHouseNumber(streetValue: unknown, houseNumberValue?: unknown) {
  let street = safeString(streetValue);
  let houseNumber = safeString(houseNumberValue);
  if (houseNumber) {
    const escaped = houseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    street = street.replace(new RegExp(`\\s+${escaped}$`, "i"), "").trim();
  } else {
    const match = street.match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)$/);
    if (match) {
      street = safeString(match[1]);
      houseNumber = safeString(match[2]);
    }
  }
  return { street, houseNumber };
}

function splitLooseObjectAddress(value: unknown) {
  const address = safeString(value).replace(/\s+/g, " ");
  const match = address.match(/^(.*?)(?:,\s*)(\d{4,6})\s+(.+)$/);
  if (!match) return { street: address, houseNumber: "", zip: "", city: "" };
  const street = splitOfferStreetAndHouseNumber(match[1]);
  return {
    street: street.street,
    houseNumber: street.houseNumber,
    zip: safeString(match[2]),
    city: safeString(match[3]),
  };
}

export function resolveOfferPropertyAddress(planning: any, customer: any) {
  const profile = planning?.data?.profile ?? {};
  const looseObjectAddress = splitLooseObjectAddress(
    planning?.objectAddress ?? planning?.data?.objectAddress,
  );
  const candidates = [
    {
      street: safeString(planning?.propertyStreet),
      houseNumber: safeString(planning?.propertyHouseNumber),
      zip: safeString(planning?.propertyZip),
      city: safeString(planning?.propertyCity),
    },
    looseObjectAddress,
    {
      street: safeString(planning?.buildingAddress?.street ?? planning?.building?.street),
      houseNumber: safeString(planning?.buildingAddress?.streetNo ?? planning?.building?.streetNo),
      zip: safeString(planning?.buildingAddress?.zip ?? planning?.building?.zip),
      city: safeString(planning?.buildingAddress?.city ?? planning?.building?.city),
    },
    {
      street: safeString(profile?.buildingStreet),
      houseNumber: safeString(profile?.buildingStreetNo),
      zip: safeString(profile?.buildingZip),
      city: safeString(profile?.buildingCity),
    },
    {
      street: safeString(customer?.buildingStreet),
      houseNumber: safeString(customer?.buildingStreetNo),
      zip: safeString(customer?.buildingZip),
      city: safeString(customer?.buildingCity),
    },
    {
      street: safeString(profile?.billingStreet ?? profile?.street),
      houseNumber: safeString(profile?.billingStreetNo ?? profile?.streetNo),
      zip: safeString(profile?.billingZip ?? profile?.zip),
      city: safeString(profile?.billingCity ?? profile?.city),
    },
    {
      street: safeString(customer?.street),
      houseNumber: safeString(customer?.streetNo),
      zip: safeString(customer?.zip),
      city: safeString(customer?.city),
    },
  ];
  const propertyZip = candidates.find((candidate) => candidate.zip)?.zip ?? "";
  const propertyCity = candidates.find((candidate) => candidate.city)?.city ?? "";
  const placeLine = [propertyZip, propertyCity].filter(Boolean).join(" ");
  const streetCandidate = candidates.find((candidate) => candidate.street);
  const rawStreet = removeDuplicatePlace(
    streetCandidate?.street ?? "",
    placeLine,
  );
  const explicitHouseNumber = streetCandidate?.houseNumber || "";
  const split = splitOfferStreetAndHouseNumber(rawStreet, explicitHouseNumber);
  const propertyStreetLine = [split.street, split.houseNumber].filter(Boolean).join(" ");
  return {
    addressStreet: split.street || null,
    addressHouseNumber: split.houseNumber || null,
    propertyStreetLine,
    propertyZip,
    propertyCity,
    objectAddress: [propertyStreetLine, placeLine].filter(Boolean).join(", "),
  };
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

export function assertHeatingOfferIssuable(commercial: any) {
  const contractualItems = Array.isArray(commercial?.issuedItems)
    ? commercial.issuedItems.filter((item: any) => item?.optional !== true)
    : [];
  if (
    contractualItems.length === 0 ||
    !contractualItems.some((item: any) => Number(item?.lineTotalNet) > 0) ||
    Number(commercial?.grossPriceChf ?? 0) <= 0
  ) {
    throw new Error("Das Heizungsangebot enthält keine abrechenbaren Vertragspositionen.");
  }
}

export function buildHeatingOfferIssuedSnapshot(args: {
  planning: any;
  customer: any;
  commercial: any;
  issuedAt: Date;
  pdfFileId: string;
  pdfSha256: string;
}): HeatingOfferIssuedSnapshot {
  assertHeatingOfferIssuable(args.commercial);
  const profile = args.planning?.data?.profile ?? {};
  const publicCustomer = buildPublicOfferCustomerFields(args.planning, args.customer);
  const heatingDocumentCustomer = resolveHeatingDocumentCustomer(args.planning, args.customer);
  const issuedItems = Array.isArray(args.commercial?.issuedItems)
    ? args.commercial.issuedItems
    : [];
  const paymentTerms =
    safeString(args.planning?.data?.reportOptions?.paymentTerms) ||
    safeString(args.planning?.data?.reportOptions?.zahlungsbedingungen);
  const validUntil = new Date(args.issuedAt);
  validUntil.setDate(validUntil.getDate() + 30);
  const customerStreet = splitOfferStreetAndHouseNumber(
    profile?.billingStreet ?? profile?.street ?? args.customer?.street,
    profile?.billingStreetNo ?? profile?.streetNo ?? args.customer?.streetNo,
  );

  return {
    schemaVersion: 1,
    projectType: "heating",
    planningId: mongoIdToString(args.planning?._id),
    offerNumber: safeString(args.planning?.planningNumber),
    documentTitle: "Heizungsangebot",
    issuedAt: args.issuedAt.toISOString(),
    customer: {
      name: heatingDocumentCustomer.name,
      email: resolveCustomerEmail(args.planning, args.customer) || null,
      phone: resolvePublicCustomerPhone(args.planning, args.customer),
      salutation: publicCustomer.salutation,
      lastName: publicCustomer.customerLastName || null,
      type: publicCustomer.customerType as "private" | "company",
      companyName: publicCustomer.customerCompanyName,
      address: {
        street: customerStreet.street || null,
        houseNumber: customerStreet.houseNumber || null,
        zip: safeString(profile?.billingZip ?? profile?.zip ?? args.customer?.zip) || null,
        city: safeString(profile?.billingCity ?? profile?.city ?? args.customer?.city) || null,
      },
    },
    objectAddress: {
      ...heatingDocumentCustomer.objectAddress,
    },
    items: issuedItems.filter((item: any) => item?.optional !== true),
    optionalItems: issuedItems.filter((item: any) => item?.optional === true),
    pricing: {
      subtotalNet: Number(args.commercial?.partsTotalNet ?? 0),
      discount: {
        fixedChf: Number(args.commercial?.discountChf ?? 0),
        percent: Number(args.commercial?.discountPct ?? 0),
        percentAmountChf: Number(args.commercial?.discountFromPctChf ?? 0),
        totalChf: Number(args.commercial?.totalDiscountChf ?? 0),
      },
      netAfterDiscount: Number(args.commercial?.netAfterDiscountChf ?? 0),
      vatRate: Number(args.commercial?.vatRatePct ?? 8.1),
      vatAmount: Number(args.commercial?.vatAmountChf ?? 0),
      totalGross: Number(args.commercial?.grossPriceChf ?? 0),
    },
    paymentTerms,
    payments: normalizeSignaturePayments(
      args.planning,
      Number(args.commercial?.grossPriceChf ?? 0),
    ),
    skonto: {
      percent: Number(args.commercial?.reportSummary?.skontoPct ?? args.planning?.data?.reportOptions?.skontoPct ?? 0),
      days: Number(args.planning?.data?.reportOptions?.skontoDays ?? 10),
    },
    validity: { validUntil: validUntil.toISOString() },
    pdfFileId: args.pdfFileId,
    pdfSha256: args.pdfSha256,
  };
}

export function getHeatingOfferIssuedSnapshot(planning: any): HeatingOfferIssuedSnapshot {
  const snapshot = planning?.heatingOfferIssuedSnapshot;
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    snapshot.projectType !== "heating" ||
    safeString(snapshot.planningId) !== mongoIdToString(planning?._id) ||
    !safeString(snapshot.pdfFileId) ||
    !safeString(snapshot.pdfSha256)
  ) {
    throw new Error("Ausgestellter Heizungsangebots-Snapshot nicht gefunden.");
  }
  return snapshot as HeatingOfferIssuedSnapshot;
}

export async function buildAndStoreOfferSnapshot(args: {
  db: Db;
  planning: any;
  company: any;
  session: SessionPayload;
}) {
  const planningId = mongoIdToString(args.planning?._id);
  const companyId = safeString(args.planning?.companyId);
  const projectType = resolveProjectType(args.planning?.projectType);
  const issuedAt = new Date();
  const commercial = projectType === "heating"
    ? await computePlanningCommercialSummary(args.db, args.planning)
    : null;
  if (projectType === "heating") assertHeatingOfferIssuable(commercial);
  const files = getPlanningFilesCollection(args.db);
  const current = projectType === "photovoltaic"
    ? await files.findOne(
        {
          companyId,
          planningId,
          isDeleted: { $ne: true },
          mimeType: "application/pdf",
          $or: [{ category: "offer" }, { type: "angebot" }],
        },
        { sort: { createdAt: -1, _id: -1 } },
      )
    : null;
  const buffer = current
    ? await fetchPlanningFileBuffer(current)
    : projectType === "heating"
      ? (
          await buildPlanningDocumentPdf({
            db: args.db,
            planning: args.planning,
            company: args.company,
            session: args.session,
            documentType: "angebot",
            sections: resolveReportSections(args.planning),
            issuedAt,
            commercialSummary: commercial!,
          })
        ).pdfBytes
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
    throw new Error("Angebots-PDF ist ungültig.");
  }
  const file = await storeGeneratedSignatureFile({
    db: args.db,
    planning: args.planning,
    category: "offer_snapshot",
    title: `Angebots-Snapshot ${safeString(args.planning?.planningNumber)}`,
    fileName: `angebot-${safeString(args.planning?.planningNumber) || planningId}-snapshot.pdf`,
    mimeType: "application/pdf",
    buffer,
    actorName: safeString(args.session?.name) || "System",
  });
  const hash = sha256(buffer);
  const heatingIssuedSnapshot = projectType === "heating"
    ? buildHeatingOfferIssuedSnapshot({
        planning: args.planning,
        customer: await loadPlanningCustomer(args.db, args.planning),
        commercial,
        issuedAt,
        pdfFileId: mongoIdToString(file._id),
        pdfSha256: hash,
      })
    : null;
  return { file, buffer, hash, heatingIssuedSnapshot };
}

export async function getOfferSnapshot(db: Db, planning: any) {
  const fileId = toObjectIdOrNull(planning?.offerSnapshotFileId);
  if (!fileId) throw new Error("Angebots-Snapshot nicht gefunden.");
  const heatingSnapshot = resolveProjectType(planning?.projectType) === "heating"
    ? getHeatingOfferIssuedSnapshot(planning)
    : null;
  if (heatingSnapshot && heatingSnapshot.pdfFileId !== mongoIdToString(fileId)) {
    throw new Error("Heizungsangebots-Snapshot verweist auf ein anderes PDF.");
  }
  const file = await getPlanningFilesCollection(db).findOne({
    _id: fileId,
    companyId: safeString(planning?.companyId),
    planningId: mongoIdToString(planning?._id),
    category: "offer_snapshot",
    isDeleted: { $ne: true },
  });
  if (!file) throw new Error("Angebots-Snapshot nicht gefunden.");
  const buffer = await fetchPlanningFileBuffer(file);
  const hash = sha256(buffer);
  if (heatingSnapshot && heatingSnapshot.pdfSha256 !== hash) {
    throw new Error("Heizungsangebots-Snapshot stimmt nicht mit dem PDF überein.");
  }
  return { file, buffer, hash };
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
  const buffer = await fetchPlanningFileBuffer(file);
  if (kind === "snapshot" && resolveProjectType(planning?.projectType) === "heating") {
    const snapshot = getHeatingOfferIssuedSnapshot(planning);
    if (snapshot.pdfFileId !== mongoIdToString(file._id) || snapshot.pdfSha256 !== sha256(buffer)) {
      throw new Error("Heizungsangebots-Snapshot stimmt nicht mit dem PDF überein.");
    }
  }
  return { file, buffer };
}

export function buildPublicOfferCustomerFields(planning: any, customer: any) {
  const profile = planning?.data?.profile ?? {};
  const address = resolveOfferPropertyAddress(planning, customer);
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
    addressStreet: address.addressStreet,
    addressHouseNumber: address.addressHouseNumber,
    addressZip: address.propertyZip || null,
    addressCity: address.propertyCity || null,
    egid: safeString(profile?.egid) || safeString(customer?.egid) || null,
    buildingNumber:
      safeString(profile?.buildingNumber ?? profile?.egid) ||
      safeString(customer?.buildingNumber ?? customer?.egid) ||
      null,
    parcelNumber:
      safeString(planning?.parcelNumber) ||
      safeString(profile?.parcelNumber) ||
      safeString(customer?.parcelNumber) ||
      null,
    landRegisterNumber:
      safeString(planning?.landRegisterNumber) ||
      safeString(profile?.landRegisterNumber) ||
      safeString(customer?.landRegisterNumber) ||
      null,
  };
}

export async function buildPublicOffer(args: { db: Db; planning: any; token: string; req: Request }): Promise<any> {
  const companyId = safeString(args.planning?.companyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const projectType = resolveProjectType(args.planning?.projectType);
  if (projectType === "heating") {
    const snapshot = getHeatingOfferIssuedSnapshot(args.planning);
    const [company, terms] = await Promise.all([
      companyObjectId ? args.db.collection("companies").findOne({ _id: companyObjectId }) : null,
      downloadCompanyDocumentBuffer(args.db, companyId, "agb").catch(() => null),
    ]);
    const seller = await resolvePlanningSellerContact({
      db: args.db,
      planning: args.planning,
      company,
    });
    const base = getPublicApiBaseUrl(args.req);
    const status = normalizeOfferSignatureStatus(args.planning?.offerSignatureStatus);
    const { agbUrl, termsUrl } = buildPublicOfferTermsUrls(base, args.token, !!terms);
    return {
      projectType: "heating",
      documentTitle: snapshot.documentTitle,
      vollmachtRequired: false,
      offerNumber: snapshot.offerNumber,
      planningId: snapshot.planningId,
      issuedAt: snapshot.issuedAt,
      companyName: safeString(company?.name),
      companyLogoUrl: safeString(company?.branding?.logoUrl),
      ...buildPublicCompanyFields(company),
      sellerName: seller.sellerName,
      sellerEmail: seller.sellerEmail,
      sellerPhone: seller.sellerPhone,
      customerName: snapshot.customer.name,
      customerEmail: snapshot.customer.email,
      customerPhone: snapshot.customer.phone,
      salutation: snapshot.customer.salutation,
      customerLastName: snapshot.customer.lastName,
      customerType: snapshot.customer.type,
      customerCompanyName: snapshot.customer.companyName,
      customerAddress: snapshot.customer.address,
      projectTitle: snapshot.documentTitle,
      objectAddress: snapshot.objectAddress.formatted,
      items: snapshot.items,
      optionalItems: snapshot.optionalItems,
      pricing: snapshot.pricing,
      totalInklMwst: snapshot.pricing.totalGross,
      optionalTotalChf: snapshot.optionalItems.reduce(
        (sum, item) => sum + Number(item?.lineTotalNet ?? 0),
        0,
      ),
      paymentTerms: snapshot.paymentTerms,
      payments: snapshot.payments,
      skonto: snapshot.skonto,
      validUntil: snapshot.validity.validUntil,
      pdfSha256: snapshot.pdfSha256,
      pdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf`,
      agbUrl,
      termsUrl,
      status,
      expiresAt: iso(args.planning?.offerSignatureTokenExpiresAt),
      signedAt: iso(args.planning?.offerSignedAt),
      signedPdfUrl:
        status === "signed"
          ? `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf?type=signed`
          : null,
      confirmationPdfUrl: null,
    };
  }
  const [company, customer, commercial, terms] = await Promise.all([
    companyObjectId ? args.db.collection("companies").findOne({ _id: companyObjectId }) : null,
    loadPlanningCustomer(args.db, args.planning),
    computePlanningCommercialSummary(args.db, args.planning),
    downloadCompanyDocumentBuffer(args.db, companyId, "agb").catch(() => null),
  ]);
  const status = normalizeOfferSignatureStatus(args.planning?.offerSignatureStatus);
  const seller = await resolvePlanningSellerContact({
    db: args.db,
    planning: args.planning,
    company,
  });
  const base = getPublicApiBaseUrl(args.req);
  const requestedAt = args.planning?.offerSignatureRequestedAt
    ? new Date(args.planning.offerSignatureRequestedAt)
    : new Date();
  const validUntil = new Date(requestedAt.getTime() + 30 * 86_400_000);
  const { agbUrl, termsUrl } = buildPublicOfferTermsUrls(base, args.token, !!terms);
  return {
    vollmachtRequired: isOfferVollmachtRequired(args.planning),
    offerNumber: safeString(args.planning?.planningNumber),
    planningId: mongoIdToString(args.planning?._id),
    companyName: safeString(company?.name),
    companyLogoUrl: safeString(company?.branding?.logoUrl),
    ...buildPublicCompanyFields(company),
    sellerName: seller.sellerName,
    sellerEmail: seller.sellerEmail,
    sellerPhone: seller.sellerPhone,
    customerName: resolveCustomerName(args.planning, customer),
    customerEmail: resolveCustomerEmail(args.planning, customer),
    customerPhone: resolvePublicCustomerPhone(args.planning, customer),
    ...buildPublicOfferCustomerFields(args.planning, customer),
    projectTitle: safeString(args.planning?.title) || safeString(args.planning?.planningNumber),
    objectAddress: resolveOfferPropertyAddress(args.planning, customer).objectAddress,
    totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
    subsidyChf: Number(commercial?.subsidyChf ?? 0),
    effectiveCostChf: Number(commercial?.effectiveCostChf ?? 0),
    optionalTotalChf: Number(commercial?.optionalTotalChf ?? 0),
    optionalItems: Array.isArray(commercial?.optionalItems)
      ? commercial.optionalItems
      : [],
    paymentTerms:
      safeString(args.planning?.data?.reportOptions?.paymentTerms) ||
      safeString(args.planning?.data?.reportOptions?.zahlungsbedingungen),
    payments: normalizeSignaturePayments(args.planning, Number(commercial?.grossPriceChf ?? 0)),
    validUntil: validUntil.toISOString(),
    pdfUrl: `${base}/api/public/offer-signature/${encodeURIComponent(args.token)}/pdf`,
    agbUrl,
    termsUrl,
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

export function buildPublicOfferTermsUrls(base: string, token: string, available: boolean) {
  const url = available
    ? `${base.replace(/\/$/, "")}/api/public/offer-signature/${encodeURIComponent(token)}/terms`
    : null;
  return { agbUrl: url, termsUrl: url };
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
    isServiceSession: true,
  };
}

export function buildSignatureCustomerPayoutUpdate(args: {
  accountHolder: string | null;
  iban: string | null;
  bankName?: string | null;
  updatedAt: Date;
}) {
  return {
    subsidyPayoutAccountHolder: args.accountHolder,
    subsidyPayoutIban: args.iban,
    ...(args.bankName !== undefined
      ? { subsidyPayoutBankName: args.bankName }
      : {}),
    updatedAt: args.updatedAt,
  };
}

export function buildSignedSessionCookie(session: SessionPayload, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `session=${payload}.${signature}`;
}

export { buildContentDispositionInline };
