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
import { sanitizePdfText } from "@/lib/pdfText";
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
    db.collection("plannings").createIndex({ signatureToken: 1 }),
    db.collection("plannings").createIndex({ signatureTokenHash: 1 }),
    db.collection("plannings").createIndex({ signatureStatus: 1, signatureTokenExpiresAt: 1 }),
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

export async function findPlanningByPublicSignatureToken(db: Db, token: string) {
  if (!isValidSignatureToken(token)) return null;
  const active = await db.collection("plannings").findOne({ signatureToken: token });
  if (active) return active;
  return db.collection("plannings").findOne({
    signatureTokenHash: sha256(token),
    signatureStatus: { $in: ["signed", "expired"] },
  });
}

export async function expireSignatureIfNeeded(db: Db, planning: any, token?: string) {
  const status = normalizeSignatureStatus(planning?.signatureStatus);
  const expiresAt = planning?.signatureTokenExpiresAt
    ? new Date(planning.signatureTokenExpiresAt)
    : null;
  if (
    !["sent", "viewed"].includes(status) ||
    !expiresAt ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() >= Date.now()
  ) {
    return planning;
  }
  const now = new Date();
  await db.collection("plannings").updateOne(
    { _id: planning._id, signatureStatus: { $in: ["sent", "viewed"] } },
    {
      $set: {
        signatureStatus: "expired",
        signatureToken: null,
        signatureTokenHash: safeString(planning?.signatureTokenHash) || (token ? sha256(token) : null),
        updatedAt: now,
      },
      $push: { signatureAudit: buildSignatureAuditEntry({ event: "expired", at: now }) },
    },
  );
  return { ...planning, signatureStatus: "expired", signatureToken: null, updatedAt: now };
}

export function parseSignatureRequestInput(body: any) {
  const email = safeString(body?.email).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("Ungültige E-Mail-Adresse.");
  const requestedDays = Number(body?.expiresInDays ?? 14);
  if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 90) {
    throw new Error("expiresInDays muss zwischen 1 und 90 liegen.");
  }
  return {
    email,
    message: safeString(body?.message).slice(0, 4000),
    expiresInDays: Math.trunc(requestedDays),
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
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
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
  page.drawText(`Auftrag ${sanitizePdfText(args.orderId)}`, { x: margin + 18, y: 760, size: 9, font, color: muted });

  const rows = [
    ["Auftragsnummer", args.orderId],
    ["Kunde", args.customerName],
    ["Projekt", args.projectTitle],
    ["Betrag inkl. MwSt.", `CHF ${Number(args.totalInklMwst || 0).toFixed(2)}`],
  ];
  let y = 710;
  for (const [label, value] of rows) {
    page.drawText(sanitizePdfText(label), { x: margin, y, size: 8, font, color: muted });
    page.drawText(sanitizePdfText(value || "-"), { x: 190, y, size: 10, font: bold, color: dark });
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
  ];
  y = 342;
  for (const [label, value] of detailRows) {
    page.drawText(sanitizePdfText(label), { x: margin, y, size: 7.5, font, color: muted });
    page.drawText(sanitizePdfText(value || "-"), { x: 190, y, size: 8.5, font, color: dark });
    y -= 23;
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

  page.drawText("SHA-256 des Original-PDF", { x: margin, y: y - 8, size: 7.5, font, color: muted });
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
    text: "Einfache elektronische Signatur (EES) gemaess Art. 14 OR / ZertES.",
    x: margin + 14,
    y: 78,
    width: 475,
    font: bold,
    size: 8.5,
    color: dark,
  });
  page.drawText(
    placedInField
      ? "Das Unterschriftsbild wurde zusaetzlich im PDF-Formularfeld platziert."
      : "Das Originaldokument wurde unveraendert vor dieser Protokollseite uebernommen.",
    { x: margin + 14, y: 57, size: 6.8, font, color: muted },
  );
  pdf.setTitle(`${sanitizePdfText(args.orderId)} - unterschrieben`);
  pdf.setSubject("EES Unterschriftsprotokoll");
  pdf.setModificationDate(args.signedAt);
  return Buffer.from(await pdf.save());
}

export async function storeGeneratedSignatureFile(args: {
  db: Db;
  planning: any;
  category: "signature" | "auftrag_signiert";
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

function normalizePayments(planning: any, totalInklMwst: number) {
  const source =
    planning?.data?.angebot?.payments ??
    planning?.data?.offer?.payments ??
    planning?.data?.reportOptions?.payments ??
    [];
  if (!Array.isArray(source)) return [];
  return source.map((row: any, index: number) => {
    const pct = Number(row?.pct ?? row?.percent ?? row?.percentage ?? 0);
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
    payments: normalizePayments(args.planning, Number(commercial?.grossPriceChf ?? 0)),
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
        status: "active",
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
