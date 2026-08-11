import crypto from "node:crypto";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { PDFButton, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  uploadGeneratedPlanningFileBuffer,
} from "@/lib/planningFiles";
import { buildIdVariants, getSessionUserMeta } from "@/lib/tasks";
import { ensureNotificationIndexes, getNotificationsCollection } from "@/lib/notifications";
import {
  advanceAuftragSteps,
  getHydratedAuftragState,
  logAuftragAdvance,
  persistAuftragStepsState,
} from "@/lib/auftragPipeline";

export const SIGNATURE_STATUSES = [
  "none",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
] as const;

export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

let ensureSignatureIndexesPromise: Promise<void> | null = null;

function signaturePdfText(value: unknown) {
  const text = safeString(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/\u00a0/g, " ");
  return text.normalize("NFC").replace(/[^\n\r\t\x20-\x7e\xa0-\xff]/g, "");
}

export function getAppBaseUrl() {
  return (safeString(process.env.APP_BASE_URL) || "https://app.helionic.ch").replace(/\/+$/, "");
}

export function buildSignatureLink(token: string) {
  return `${getAppBaseUrl()}/signieren/${encodeURIComponent(token)}`;
}

export function getPublicApiBaseUrl(req?: Request) {
  const configured = safeString(process.env.PUBLIC_API_BASE_URL).replace(/\/+$/, "");
  if (configured) return configured;
  if (req) return new URL(req.url).origin;
  return "https://planner.helionic.ch";
}

export function sha256(input: Buffer | Uint8Array | string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeSignatureStatus(value: unknown): SignatureStatus {
  const normalized = safeString(value).toLowerCase() as SignatureStatus;
  return SIGNATURE_STATUSES.includes(normalized) ? normalized : "none";
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const normalized = safeString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeSignatureAudit(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry: any) => ({
    at: isoDate(entry?.at),
    event: safeString(entry?.event),
    ip: safeString(entry?.ip),
    userAgent: safeString(entry?.userAgent),
    meta: entry?.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta) ? entry.meta : {},
  }));
}

export function normalizeSignatureFields(planning: any) {
  return {
    signatureStatus: normalizeSignatureStatus(planning?.signatureStatus),
    signatureTokenExpiresAt: isoDate(planning?.signatureTokenExpiresAt),
    signatureRequestedAt: isoDate(planning?.signatureRequestedAt),
    signatureRequestedByUserId:
      mongoIdToString(planning?.signatureRequestedByUserId) ||
      safeString(planning?.signatureRequestedByUserId) ||
      null,
    signatureRequestedByName: safeString(planning?.signatureRequestedByName) || null,
    signatureSentToEmail: safeString(planning?.signatureSentToEmail) || null,
    signatureViewedAt: isoDate(planning?.signatureViewedAt),
    signedAt: isoDate(planning?.signedAt),
    signerName: safeString(planning?.signerName) || null,
    signerEmail: safeString(planning?.signerEmail) || null,
    signatureImageFileId:
      mongoIdToString(planning?.signatureImageFileId) || safeString(planning?.signatureImageFileId) || null,
    signedPdfFileId:
      mongoIdToString(planning?.signedPdfFileId) || safeString(planning?.signedPdfFileId) || null,
    signedPdfSha256: safeString(planning?.signedPdfSha256) || null,
    sourcePdfSha256: safeString(planning?.sourcePdfSha256) || null,
    signatureDeclinedAt: isoDate(planning?.signatureDeclinedAt),
    signatureDeclinedReason: safeString(planning?.signatureDeclinedReason) || null,
    signatureAudit: normalizeSignatureAudit(planning?.signatureAudit),
  };
}

export function buildDefaultOrderSignatureFields() {
  return {
    signatureStatus: "none" as const,
    signatureToken: null,
    signatureTokenHash: null,
    signatureTokenExpiresAt: null,
    signatureRequestedAt: null,
    signatureRequestedByUserId: null,
    signatureRequestedByName: null,
    signatureSentToEmail: null,
    signatureViewedAt: null,
    signedAt: null,
    signerName: null,
    signerEmail: null,
    signerIp: null,
    signerUserAgent: null,
    signatureImageFileId: null,
    signedPdfFileId: null,
    signedPdfSha256: null,
    sourcePdfSha256: null,
    signatureDeclinedAt: null,
    signatureDeclinedReason: null,
    signatureAudit: [],
  };
}

export function buildSignatureResponse(planning: any) {
  const signature = normalizeSignatureFields(planning);
  const expiresAt = planning?.signatureTokenExpiresAt
    ? new Date(planning.signatureTokenExpiresAt)
    : null;
  const token = safeString(planning?.signatureToken);
  const hasValidLink =
    !!token &&
    ["sent", "viewed"].includes(signature.signatureStatus) &&
    !!expiresAt &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() > Date.now();
  return {
    ...signature,
    ...(hasValidLink ? { signatureLink: buildSignatureLink(token) } : {}),
  };
}

export function buildSignatureAuditEntry(args: {
  event: string;
  req?: Request;
  meta?: Record<string, unknown>;
  at?: Date;
}) {
  return {
    at: args.at ?? new Date(),
    event: safeString(args.event),
    ip: args.req ? extractRequestIp(args.req) : "",
    userAgent: args.req ? safeString(args.req.headers.get("user-agent")).slice(0, 1000) : "",
    meta: args.meta ?? {},
  };
}

export function extractRequestIp(req: Request) {
  return (
    safeString(req.headers.get("x-forwarded-for")).split(",")[0]?.trim() ||
    safeString(req.headers.get("x-real-ip")) ||
    "unknown"
  ).slice(0, 200);
}

export function canManageOrderSignatures(session: SessionPayload | null | undefined) {
  if ((session as any)?.isPlatformSuperAdmin === true) return true;
  const direct = [
    (session as any)?.activeRole,
    (session as any)?.role,
    (session as any)?.activeCompanyRole,
    (session as any)?.membershipRole,
    (session as any)?.companyRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);
  const listed = Array.isArray((session as any)?.roles)
    ? (session as any).roles.map((value: unknown) => safeString(value).toLowerCase()).filter(Boolean)
    : [];
  const roles = new Set([...direct, ...listed]);
  return ["sales", "verkauf", "admin", "administrator", "company_admin", "owner", "inhaber"].some(
    (role) => roles.has(role),
  );
}

export async function ensureOrderSignatureIndexes(db: Db) {
  if (ensureSignatureIndexesPromise) return ensureSignatureIndexesPromise;
  ensureSignatureIndexesPromise = Promise.all([
    db.collection<any>("plannings").createIndex({ signatureToken: 1 }),
    db.collection<any>("plannings").createIndex({ signatureTokenHash: 1 }),
    db.collection<any>("plannings").createIndex({ signatureStatus: 1, signatureTokenExpiresAt: 1 }),
    db.collection("signatureRateLimits").createIndex({ key: 1 }, { unique: true }),
    db.collection("signatureRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureSignatureIndexesPromise = null;
      throw error;
    });
  return ensureSignatureIndexesPromise;
}

export async function enforceSignatureRateLimit(args: {
  db: Db;
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
}) {
  await ensureOrderSignatureIndexes(args.db);
  const now = Date.now();
  const bucket = Math.floor(now / args.windowMs);
  const subjectHash = sha256(args.subject);
  const key = `${safeString(args.scope)}:${subjectHash}:${bucket}`;
  const result = await args.db.collection("signatureRateLimits").findOneAndUpdate(
    { key },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        key,
        expiresAt: new Date((bucket + 2) * args.windowMs),
        createdAt: new Date(now),
      },
    },
    { upsert: true, returnDocument: "after", includeResultMetadata: false },
  );
  return Number((result as any)?.count ?? 0) <= args.limit;
}

export async function enforcePublicSignatureIpRateLimit(db: Db, req: Request) {
  return enforceSignatureRateLimit({
    db,
    scope: "public-ip",
    subject: extractRequestIp(req),
    limit: 60,
    windowMs: 60_000,
  });
}

export function isValidSignatureToken(token: unknown) {
  return TOKEN_PATTERN.test(safeString(token));
}

export async function findPlanningByPublicSignatureToken(db: Db, token: string): Promise<any | null> {
  if (!isValidSignatureToken(token)) return null;
  const active = await db.collection<any>("plannings").findOne({ signatureToken: token });
  if (active) return active;
  return db.collection<any>("plannings").findOne({
    signatureTokenHash: sha256(token),
    signatureStatus: { $in: ["signed", "expired"] },
  });
}

export async function expireSignatureIfNeeded(db: Db, planning: any, token?: string): Promise<any | null> {
  const status = normalizeSignatureStatus(planning?.signatureStatus);
  const expiresAt = planning?.signatureTokenExpiresAt
    ? new Date(planning.signatureTokenExpiresAt)
    : null;
  if (!["sent", "viewed"].includes(status)) {
    return planning;
  }
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() >= Date.now()) {
    return planning;
  }
  const now = new Date();
  const updated = await db.collection<any>("plannings").findOneAndUpdate(
    { _id: planning._id, signatureStatus: { $in: ["sent", "viewed"] } },
    {
      $set: {
        signatureStatus: "expired",
        signatureToken: null,
        signatureTokenHash: safeString(planning?.signatureTokenHash) || (token ? sha256(token) : null),
        updatedAt: now,
      },
      $push: {
        signatureAudit: buildSignatureAuditEntry({ event: "expired", at: now }) as never,
      },
    },
    { returnDocument: "after", includeResultMetadata: false },
  );
  if (updated) return updated;
  if (token) return findPlanningByPublicSignatureToken(db, token);
  return db.collection<any>("plannings").findOne({ _id: planning._id });
}

export function parseSignatureRequestInput(body: any) {
  const email = safeString(body?.email).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("Ungültige E-Mail-Adresse.");
  const requestedDays = Number(body?.expiresInDays ?? 14);
  if (
    !Number.isFinite(requestedDays) ||
    !Number.isInteger(requestedDays) ||
    requestedDays < 1 ||
    requestedDays > 90
  ) {
    throw new Error("expiresInDays muss eine ganze Zahl zwischen 1 und 90 sein.");
  }
  return {
    email,
    message: safeString(body?.message).slice(0, 4000),
    expiresInDays: requestedDays,
    sendEmail: body?.sendEmail !== false,
  };
}

export function resolveCustomerEmail(planning: any, customer?: any) {
  return (
    safeString(planning?.data?.profile?.email) ||
    safeString(planning?.data?.profile?.contactEmail) ||
    safeString(customer?.email)
  ).toLowerCase();
}

export function resolveCustomerName(planning: any, customer?: any) {
  return (
    safeString(planning?.summary?.customerName) ||
    safeString(planning?.data?.profile?.companyName) ||
    safeString(customer?.companyName) ||
    [
      safeString(planning?.data?.profile?.firstName ?? planning?.data?.profile?.contactFirstName ?? customer?.firstName),
      safeString(planning?.data?.profile?.lastName ?? planning?.data?.profile?.contactLastName ?? customer?.lastName),
    ]
      .filter(Boolean)
      .join(" ") ||
    safeString(customer?.name)
  );
}

export function resolveObjectAddress(planning: any) {
  const profile = planning?.data?.profile ?? {};
  return [
    [safeString(profile?.buildingStreet), safeString(profile?.buildingStreetNo)].filter(Boolean).join(" ") ||
      [safeString(profile?.street), safeString(profile?.houseNumber)].filter(Boolean).join(" "),
    [safeString(profile?.buildingZip), safeString(profile?.buildingCity)].filter(Boolean).join(" ") ||
      [safeString(profile?.zip), safeString(profile?.city)].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
}

export async function getSignatureSourcePdf(db: Db, planning: any) {
  const fileId = toObjectIdOrNull(planning?.orderSnapshotFileId);
  if (!fileId) throw new Error("Auftrags-PDF nicht gefunden.");
  const file = await getPlanningFilesCollection(db).findOne({
    _id: fileId,
    companyId: safeString(planning?.companyId),
    planningId: mongoIdToString(planning?._id),
    category: "auftrag",
    isDeleted: { $ne: true },
  });
  if (!file) throw new Error("Auftrags-PDF nicht gefunden.");
  const buffer = await fetchPlanningFileBuffer(file);
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Auftrags-PDF ist ungültig.");
  }
  return { file, buffer, hash: sha256(buffer) };
}

export function validateSignatureImage(value: unknown) {
  const dataUrl = safeString(value);
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("Die Unterschrift muss als PNG übermittelt werden.");
  const buffer = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) {
    throw new Error("Die Unterschrift darf maximal 2 MB gross sein.");
  }
  const pngHeader = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngHeader) {
    throw new Error("Die Unterschrift ist keine gültige PNG-Datei.");
  }
  return buffer;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = signaturePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawWrappedText(args: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  width: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
}) {
  const lineHeight = args.lineHeight ?? args.size * 1.35;
  const lines = wrapText(args.text, args.font, args.size, args.width);
  lines.forEach((line, index) =>
    args.page.drawText(line, {
      x: args.x,
      y: args.y - index * lineHeight,
      size: args.size,
      font: args.font,
      color: args.color ?? rgb(0.13, 0.18, 0.22),
    }),
  );
  return args.y - lines.length * lineHeight;
}

function formatZurichTimestamp(date: Date) {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  })
    .format(date)
    .replace(" ", "T")
    .replace(" GMT", "");
  const readable = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    dateStyle: "full",
    timeStyle: "long",
  }).format(date);
  return { iso: local, readable };
}

async function placeSignatureInAcroForm(pdf: PDFDocument, image: Awaited<ReturnType<PDFDocument["embedPng"]>>) {
  try {
    const fields = pdf.getForm().getFields();
    const signatureButton = fields.find((field) => {
      const name = field.getName().toLowerCase();
      return (
        field instanceof PDFButton &&
        (name.includes("unterschrift") || name.includes("signature")) &&
        (name.includes("kunde") || name.includes("customer"))
      );
    });
    if (signatureButton instanceof PDFButton) {
      signatureButton.setImage(image);
      pdf.getForm().flatten();
      return true;
    }
  } catch {
    // Static order PDFs usually do not have AcroForm fields.
  }
  return false;
}

export async function createSignedOrderPdf(args: {
  sourcePdf: Buffer;
  signaturePng: Buffer;
  orderId: string;
  customerName: string;
  projectTitle: string;
  totalInklMwst: number;
  signerName: string;
  signerEmail: string;
  place?: string;
  signedAt: Date;
  signerIp: string;
  signerUserAgent: string;
  sourcePdfSha256: string;
  documentKind?: "Auftrag" | "Offerte";
  openedAt?: Date | null;
  tokenId?: string;
  signaturePlace?: string;
  legalText?: string;
  sourceHashLabel?: string;
}) {
  const pdf = await PDFDocument.load(args.sourcePdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signatureImage = await pdf.embedPng(args.signaturePng);
  const placedInField = await placeSignatureInAcroForm(pdf, signatureImage);
  const page = pdf.addPage([595.28, 841.89]);
  const dark = rgb(0.10, 0.16, 0.20);
  const muted = rgb(0.38, 0.44, 0.48);
  const teal = rgb(0.10, 0.55, 0.48);
  const border = rgb(0.84, 0.87, 0.88);
  const margin = 46;

  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: margin, y: 764, width: 6, height: 34, color: teal });
  page.drawText("Unterschriftsprotokoll", { x: margin + 18, y: 780, size: 20, font: bold, color: dark });
  const documentKind = args.documentKind ?? "Auftrag";
  page.drawText(`${documentKind} ${signaturePdfText(args.orderId)}`, { x: margin + 18, y: 760, size: 9, font, color: muted });

  const rows = [
    [documentKind === "Offerte" ? "Offertennummer" : "Auftragsnummer", args.orderId],
    ["Kunde", args.customerName],
    ["Projekt", args.projectTitle],
    ["Betrag inkl. MwSt.", `CHF ${Number(args.totalInklMwst || 0).toFixed(2)}`],
  ];
  let y = 710;
  for (const [label, value] of rows) {
    page.drawText(signaturePdfText(label), { x: margin, y, size: 8, font, color: muted });
    page.drawText(signaturePdfText(value || "-"), { x: 190, y, size: 10, font: bold, color: dark });
    page.drawLine({ start: { x: margin, y: y - 10 }, end: { x: 549, y: y - 10 }, thickness: 0.6, color: border });
    y -= 38;
  }

  page.drawText("Unterschrift Kunde", { x: margin, y: 548, size: 9, font: bold, color: dark });
  page.drawRectangle({ x: margin, y: 370, width: 503, height: 160, borderWidth: 0.8, borderColor: border, color: rgb(0.99, 0.995, 0.995) });
  const scale = Math.min(440 / signatureImage.width, 115 / signatureImage.height, 1.5);
  const imageWidth = signatureImage.width * scale;
  const imageHeight = signatureImage.height * scale;
  page.drawImage(signatureImage, {
    x: margin + (503 - imageWidth) / 2,
    y: 392 + (115 - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  });

  const timestamp = formatZurichTimestamp(args.signedAt);
  const detailRows = [
    ["Name", args.signerName],
    ["E-Mail", args.signerEmail],
    ...(safeString(args.place) ? [["Ort", safeString(args.place)]] : []),
    ["Zeitstempel ISO (Europe/Zurich)", timestamp.iso],
    ["Zeitstempel lesbar", timestamp.readable],
    ["IP-Adresse", args.signerIp],
    ...(args.openedAt ? [["Erstmals geöffnet (UTC)", args.openedAt.toISOString()]] : []),
    ...(safeString(args.tokenId) ? [["Token-ID (SHA-256)", safeString(args.tokenId)]] : []),
    ...(safeString(args.signaturePlace) ? [["Abschlussart", safeString(args.signaturePlace)]] : []),
  ];
  y = 342;
  const detailRowSpacing = args.documentKind === "Offerte" ? 18 : 23;
  for (const [label, value] of detailRows) {
    page.drawText(signaturePdfText(label), { x: margin, y, size: 7.5, font, color: muted });
    page.drawText(signaturePdfText(value || "-"), { x: 190, y, size: 8.5, font, color: dark });
    y -= detailRowSpacing;
  }
  page.drawText("User-Agent", { x: margin, y, size: 7.5, font, color: muted });
  y = drawWrappedText({
    page,
    text: args.signerUserAgent || "-",
    x: 190,
    y,
    width: 350,
    font,
    size: 7,
    color: dark,
    lineHeight: 9,
  });

  page.drawText(
    signaturePdfText(args.sourceHashLabel || "SHA-256 des Original-PDF"),
    { x: margin, y: y - 8, size: 7.5, font, color: muted },
  );
  drawWrappedText({
    page,
    text: args.sourcePdfSha256,
    x: 190,
    y: y - 8,
    width: 350,
    font,
    size: 7,
    color: dark,
    lineHeight: 9,
  });

  page.drawRectangle({ x: margin, y: 44, width: 503, height: 58, color: rgb(0.94, 0.98, 0.97), borderColor: teal, borderWidth: 0.8 });
  drawWrappedText({
    page,
    text:
      args.legalText ||
      "Einfache elektronische Signatur (EES) gemäss Art. 14 OR / ZertES.",
    x: margin + 14,
    y: 78,
    width: 475,
    font: bold,
    size: 8.5,
    color: dark,
  });
  page.drawText(
    placedInField
      ? "Das Unterschriftsbild wurde zusätzlich im PDF-Formularfeld platziert."
      : "Das Originaldokument wurde unverändert vor dieser Protokollseite übernommen.",
    { x: margin + 14, y: 57, size: 6.8, font, color: muted },
  );
  pdf.setTitle(`${signaturePdfText(args.orderId)} - unterschrieben`);
  pdf.setSubject("EES Unterschriftsprotokoll");
  pdf.setModificationDate(args.signedAt);
  return Buffer.from(await pdf.save());
}

export async function appendOfferConfirmationSignatureProtocol(args: {
  confirmationPdf: Buffer;
  signaturePng: Buffer;
  orderId: string;
  customerName: string;
  projectTitle: string;
  totalInklMwst: number;
  signerName: string;
  signerEmail: string;
  place: string;
  signedAt: Date;
  signerIp: string;
  signerUserAgent: string;
  signedOfferSha256: string;
}) {
  return createSignedOrderPdf({
    sourcePdf: args.confirmationPdf,
    signaturePng: args.signaturePng,
    orderId: args.orderId,
    customerName: args.customerName,
    projectTitle: args.projectTitle,
    totalInklMwst: args.totalInklMwst,
    signerName: args.signerName,
    signerEmail: args.signerEmail,
    place: args.place,
    signedAt: args.signedAt,
    signerIp: args.signerIp,
    signerUserAgent: args.signerUserAgent,
    sourcePdfSha256: args.signedOfferSha256,
    documentKind: "Auftrag",
    legalText: "Einfache elektronische Signatur (EES) gemäss Art. 14 OR.",
    sourceHashLabel: "SHA-256 der signierten Offerte",
  });
}

export async function createOfferConfirmationPdf(args: {
  sourcePdf: Buffer;
  orderId: string;
  offerNumber: string;
  customerName: string;
  projectTitle: string;
  signerName: string;
  signedAt: Date;
  totalInklMwst: number;
  payments: Array<{ label: string; pct: number; amount: number }>;
  propertyStreet?: string | null;
  propertyHouseNumber?: string | null;
  propertyZip?: string | null;
  propertyCity?: string | null;
  buildingNumber?: string | null;
  parcelNumber?: string | null;
  bankAccountHolder?: string | null;
  bankIban?: string | null;
  withdrawalRightApplies: boolean;
  withdrawalUntil: Date | null;
}) {
  const pdf = await PDFDocument.load(args.sourcePdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const dark = rgb(0.1, 0.16, 0.2);
  const muted = rgb(0.38, 0.44, 0.48);
  const teal = rgb(0.1, 0.55, 0.48);
  const border = rgb(0.84, 0.87, 0.88);
  const margin = 46;
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: margin, y: 764, width: 6, height: 34, color: teal });
  page.drawText("Auftragsbestätigung", { x: margin + 18, y: 780, size: 20, font: bold, color: dark });
  page.drawText(`Auftrag ${signaturePdfText(args.orderId)}`, { x: margin + 18, y: 760, size: 9, font, color: muted });
  const rows = [
    ["Vertragsdatum", args.signedAt.toISOString()],
    ["Angenommene Offerte", args.offerNumber],
    ["Kunde", args.customerName],
    ["Unterzeichner", args.signerName],
    ["Projekt", args.projectTitle],
    ["Vertragssumme inkl. MwSt.", `CHF ${Number(args.totalInklMwst || 0).toFixed(2)}`],
  ];
  let y = 710;
  for (const [label, value] of rows) {
    page.drawText(signaturePdfText(label), { x: margin, y, size: 8, font, color: muted });
    page.drawText(signaturePdfText(value || "-"), { x: 190, y, size: 9.5, font: bold, color: dark });
    page.drawLine({ start: { x: margin, y: y - 10 }, end: { x: 549, y: y - 10 }, thickness: 0.6, color: border });
    y -= 32;
  }
  page.drawText("Leistungsumfang", { x: margin, y: y - 4, size: 10, font: bold, color: dark });
  y = drawWrappedText({
    page,
    text: `Der Leistungsumfang entspricht vollständig der elektronisch angenommenen Offerte ${args.offerNumber}.`,
    x: margin,
    y: y - 24,
    width: 503,
    font,
    size: 9,
  }) - 15;

  const drawInfoSection = (
    title: string,
    sectionRows: Array<[string, string]>,
  ) => {
    if (!sectionRows.length) return;
    page.drawText(title, { x: margin, y, size: 10, font: bold, color: dark });
    y -= 19;
    for (const [label, value] of sectionRows) {
      page.drawText(signaturePdfText(label), { x: margin, y, size: 7.8, font, color: muted });
      const nextY = drawWrappedText({
        page,
        text: value,
        x: 190,
        y,
        width: 359,
        font: bold,
        size: 8.5,
        lineHeight: 10.5,
      });
      y = Math.min(y - 16, nextY - 4);
    }
    y -= 6;
  };

  const propertyStreetLine = [safeString(args.propertyStreet), safeString(args.propertyHouseNumber)]
    .filter(Boolean)
    .join(" ");
  const propertyPlaceLine = [safeString(args.propertyZip), safeString(args.propertyCity)]
    .filter(Boolean)
    .join(" ");
  const propertyAddress = [propertyStreetLine, propertyPlaceLine].filter(Boolean).join(", ");
  drawInfoSection(
    "Objekt & Grundstück",
    [
      ...(propertyAddress ? [["Objektadresse", propertyAddress] as [string, string]] : []),
      ...(safeString(args.buildingNumber)
        ? [["Gebäudenummer (EGID)", safeString(args.buildingNumber)] as [string, string]]
        : []),
      ...(safeString(args.parcelNumber)
        ? [["Parzelle / Grundstück-Nr.", safeString(args.parcelNumber)] as [string, string]]
        : []),
    ],
  );

  const formattedIban = safeString(args.bankIban)
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
  drawInfoSection(
    "Auszahlungskonto für Förderungen",
    [
      ...(safeString(args.bankAccountHolder)
        ? [["Kontoinhaber", safeString(args.bankAccountHolder)] as [string, string]]
        : []),
      ...(formattedIban ? [["IBAN", formattedIban] as [string, string]] : []),
    ],
  );

  page.drawText("Zahlungsplan", { x: margin, y, size: 10, font: bold, color: dark });
  y -= 24;
  for (const payment of args.payments.slice(0, 5)) {
    page.drawText(signaturePdfText(payment.label), { x: margin, y, size: 8.5, font, color: dark });
    page.drawText(`${payment.pct.toFixed(2)} %`, { x: 315, y, size: 8.5, font, color: muted });
    page.drawText(`CHF ${payment.amount.toFixed(2)}`, { x: 420, y, size: 8.5, font: bold, color: dark });
    y -= 20;
  }
  if (args.withdrawalRightApplies && args.withdrawalUntil) {
    page.drawRectangle({ x: margin, y: 70, width: 503, height: 125, color: rgb(1, 0.97, 0.9), borderColor: rgb(0.88, 0.61, 0.12), borderWidth: 0.8 });
    page.drawText("Widerrufsbelehrung", { x: margin + 14, y: 170, size: 10, font: bold, color: dark });
    drawWrappedText({
      page,
      text: `Dieser Vertrag wurde ausserhalb der Geschäftsräume beim Kunden abgeschlossen. Das Widerrufsrecht gemäss Art. 40a ff. OR kann bis ${args.withdrawalUntil.toISOString()} ausgeübt werden. Der Widerruf ist der Anbieterin in nachweisbarer Form mitzuteilen.`,
      x: margin + 14,
      y: 148,
      width: 475,
      font,
      size: 8.5,
      lineHeight: 12,
    });
  } else {
    page.drawRectangle({ x: margin, y: 70, width: 503, height: 58, color: rgb(0.94, 0.98, 0.97), borderColor: teal, borderWidth: 0.8 });
    drawWrappedText({
      page,
      text: "Die Auftragsbestätigung dokumentiert die elektronische Annahme der Offerte und den Vertragsschluss.",
      x: margin + 14,
      y: 104,
      width: 475,
      font,
      size: 8.5,
    });
  }
  pdf.setTitle(`Auftragsbestätigung ${signaturePdfText(args.orderId)}`);
  pdf.setSubject("Elektronisch angenommene Offerte und Auftragsbestätigung");
  pdf.setModificationDate(args.signedAt);
  return Buffer.from(await pdf.save());
}

export async function storeGeneratedSignatureFile(args: {
  db: Db;
  planning: any;
  category: "signature" | "auftrag_signiert" | "offer_snapshot" | "offer_signiert";
  title: string;
  fileName: string;
  mimeType: "image/png" | "application/pdf";
  buffer: Buffer;
  actorName: string;
}) {
  const companyId = safeString(args.planning?.companyId);
  const planningId = mongoIdToString(args.planning?._id);
  const session: SessionPayload = {
    activeCompanyId: companyId,
    userId: null,
    name: safeString(args.actorName) || "Öffentliche Signatur",
  };
  const doc = await uploadGeneratedPlanningFileBuffer({
    companyId,
    planningId,
    category: args.category,
    title: args.title,
    originalFileName: args.fileName,
    mimeType: args.mimeType,
    buffer: args.buffer,
    customerId: safeString(args.planning?.customerId) || undefined,
    session,
    type: args.category,
    linkToPlanningId: planningId,
  });
  const result = await getPlanningFilesCollection(args.db).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function loadPlanningCustomer(db: Db, planning: any) {
  const customerId = toObjectIdOrNull(planning?.customerId);
  if (!customerId) return null;
  return db.collection("customers").findOne({
    _id: customerId,
    companyId: { $in: buildIdVariants(safeString(planning?.companyId)) },
  });
}

export function normalizeSignaturePayments(planning: any, totalInklMwst: number) {
  const configured =
    planning?.data?.angebot?.payments ??
    planning?.data?.angebot?.n ??
    planning?.data?.offer?.payments ??
    planning?.data?.reportOptions?.payments ??
    [];
  const paymentTerms = safeString(
    planning?.data?.reportOptions?.paymentTerms ??
      planning?.data?.reportOptions?.zahlungsbedingungen,
  );
  const source =
    Array.isArray(configured) && configured.length === 0
      ? paymentTerms === "50 % / 50 %"
        ? [
            { label: "Anzahlung", pct: 50 },
            { label: "Schlussrechnung", pct: 50 },
          ]
        : paymentTerms === "50 % / 40 % / 10 %"
          ? [
              { label: "Anzahlung", pct: 50 },
              { label: "Zwischenrate", pct: 40 },
              { label: "Schlussrechnung", pct: 10 },
            ]
          : paymentTerms === "100 %"
            ? [{ label: "Schlussrechnung", pct: 100 }]
            : configured
      : configured;
  if (!Array.isArray(source)) return [];
  return source.map((row: any, index: number) => {
    const pct = Number(row?.pct ?? row?.percent ?? row?.percentage ?? row?.sharePct ?? 0);
    const directAmount = Number(row?.amount ?? row?.amountChf);
    const amount = Number.isFinite(directAmount)
      ? directAmount
      : Number.isFinite(pct)
        ? (totalInklMwst * pct) / 100
        : 0;
    const due = row?.dueDate ?? row?.dueAt ?? row?.date;
    const dueDate = due ? new Date(due) : null;
    return {
      label: safeString(row?.label ?? row?.name) || `Rate ${index + 1}`,
      pct: Number.isFinite(pct) ? pct : 0,
      amount: Math.round(amount * 100) / 100,
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
    };
  });
}

export async function buildPublicSignatureOrder(args: {
  db: Db;
  planning: any;
  token: string;
  req: Request;
}) {
  const companyId = safeString(args.planning?.companyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const [company, customer, commercial] = await Promise.all([
    companyObjectId ? args.db.collection("companies").findOne({ _id: companyObjectId }) : null,
    loadPlanningCustomer(args.db, args.planning),
    computePlanningCommercialSummary(args.db, args.planning),
  ]);
  const status = normalizeSignatureStatus(args.planning?.signatureStatus);
  const apiBase = getPublicApiBaseUrl(args.req);
  const canReadPdf = status !== "expired";
  return {
    orderId: safeString(args.planning?.orderId),
    companyName: safeString(company?.name),
    companyLogoUrl: safeString(company?.branding?.logoUrl),
    customerName: resolveCustomerName(args.planning, customer),
    customerEmail: resolveCustomerEmail(args.planning, customer),
    projectTitle: safeString(args.planning?.title) || safeString(args.planning?.planningNumber),
    objectAddress: resolveObjectAddress(args.planning),
    totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
    currency: "CHF",
    payments: normalizeSignaturePayments(args.planning, Number(commercial?.grossPriceChf ?? 0)),
    pdfUrl: canReadPdf
      ? `${apiBase}/api/public/signature/${encodeURIComponent(args.token)}/pdf`
      : null,
    status,
    expiresAt: isoDate(args.planning?.signatureTokenExpiresAt),
    signedAt: isoDate(args.planning?.signedAt),
    signedPdfUrl:
      status === "signed"
        ? `${apiBase}/api/public/signature/${encodeURIComponent(args.token)}/pdf`
        : null,
  };
}

export async function notifySignatureParticipants(args: {
  db: Db;
  planning: any;
  type: "signature_signed" | "signature_declined";
  signerName?: string;
  reason?: string;
}) {
  const companyId = safeString(args.planning?.companyId);
  const companyVariants = buildIdVariants(companyId);
  const admins = await args.db
    .collection("users")
    .find(
      {
        status: { $ne: "inactive" },
        memberships: {
          $elemMatch: {
            companyId: { $in: companyVariants },
            status: "active",
            role: { $in: ["owner", "admin", "inhaber", "administrator", "company_admin"] },
          },
        },
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  const requestedBy = mongoIdToString(args.planning?.signatureRequestedByUserId);
  const userIds = Array.from(
    new Set([
      ...(requestedBy ? [requestedBy] : []),
      ...admins.map((user) => mongoIdToString(user?._id)).filter(Boolean),
    ]),
  );
  if (!userIds.length) return;
  const now = new Date();
  const orderId = safeString(args.planning?.orderId);
  const signed = args.type === "signature_signed";
  await ensureNotificationIndexes(args.db);
  await getNotificationsCollection(args.db).insertMany(
    userIds.map((userId) => ({
      companyId,
      userId,
      type: args.type,
      title: signed
        ? `Auftrag ${orderId} wurde unterschrieben.`
        : `Unterschrift für Auftrag ${orderId} wurde abgelehnt.`,
      body: signed
        ? `Auftrag ${orderId} wurde von ${safeString(args.signerName) || "Kunde"} unterschrieben.`
        : safeString(args.reason) || "Der Kunde hat die Unterschrift abgelehnt.",
      link: `/auftraege/${encodeURIComponent(orderId)}`,
      meta: { orderId, planningId: mongoIdToString(args.planning?._id) },
      readAt: null,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function advanceSignedOrderPipeline(db: Db, planning: any, signerName: string) {
  const companyId = toObjectIdOrNull(planning?.companyId);
  const orderId = safeString(planning?.orderId);
  if (!companyId || !orderId) return false;
  const hydrated = await getHydratedAuftragState({ db, companyId, orderId });
  if (!hydrated) return false;
  const current = safeString(hydrated.normalizedAuftrag.currentStepKey);
  const initial = hydrated.templateSteps[0]?.key;
  const target = hydrated.templateSteps.find((step) => step.key === "auftragsbestaetigung");
  if (!target || !["gewonnen", initial].filter(Boolean).includes(current)) return false;
  const actor = { id: "", fullName: safeString(signerName) || "Kunde" };
  const advanced = advanceAuftragSteps({
    templateSteps: hydrated.templateSteps,
    existingStepsState: hydrated.stepsState,
    toStepKey: target.key,
    actor,
  });
  await persistAuftragStepsState({
    db,
    companyId,
    orderId,
    templateSteps: hydrated.templateSteps,
    stepsState: advanced.stepsState,
  });
  const now = new Date();
  await db.collection("auftraege").updateOne(
    { _id: (hydrated.auftrag as any)._id, companyId },
    {
      $set: {
        currentStepKey: advanced.currentStepKey,
        status: advanced.status,
        updatedAt: now,
      },
      $unset: { stepsState: "" },
    },
  );
  await logAuftragAdvance({
    db,
    companyId,
    auftragId: (hydrated.auftrag as any)._id,
    actor,
    fromStepKey: current,
    toStepKey: advanced.currentStepKey,
  });
  return true;
}

export function buildSignatureRequester(session: SessionPayload) {
  const meta = getSessionUserMeta(session);
  return {
    id: toObjectIdOrNull(meta.id) || meta.id || null,
    name: meta.name || "Unbekannt",
  };
}

export function buildContentDispositionInline(fileName: string) {
  const normalized = safeString(fileName).replace(/["\r\n\\]/g, "_") || "auftrag.pdf";
  return `inline; filename="${normalized}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}
