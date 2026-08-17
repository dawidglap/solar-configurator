import { Readable } from "node:stream";
import crypto from "node:crypto";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import {
  getSessionUserEmail,
  getSessionUserId,
  getSessionUserName,
  isAdminLikeRole,
} from "@/lib/tasks";

export const COMPANY_DOCUMENT_KINDS = ["agb"] as const;
export type CompanyDocumentKind = (typeof COMPANY_DOCUMENT_KINDS)[number];

const COMPANY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const COMPANY_DOCUMENT_BUCKET = "companyDocuments";

export function normalizeCompanyDocumentKind(value: unknown): CompanyDocumentKind | null {
  const normalized = safeString(value).toLowerCase() as CompanyDocumentKind;
  return COMPANY_DOCUMENT_KINDS.includes(normalized) ? normalized : null;
}

export function canManageCompanyDocuments(session: SessionPayload | null | undefined) {
  return isAdminLikeRole(session);
}

export function getCompanyDocumentsBucket(db: Db) {
  return new GridFSBucket(db, { bucketName: COMPANY_DOCUMENT_BUCKET });
}

export function getCompanyDocumentDownloadUrl(kind: CompanyDocumentKind) {
  return `/api/company-profile/documents/${kind}/download`;
}

export async function ensureCompanyDocumentIndexes(db: Db) {
  const files = db.collection(`${COMPANY_DOCUMENT_BUCKET}.files`);
  await Promise.all([
    files.createIndex(
      { "metadata.companyId": 1, "metadata.kind": 1 },
      { unique: true, sparse: true },
    ),
    files.createIndex({ "metadata.companyId": 1, uploadDate: -1 }),
  ]);
}

function buildCompanyDocumentMetadata(args: {
  companyId: string;
  kind: CompanyDocumentKind;
  filename: string;
  size: number;
  session: SessionPayload;
}) {
  return {
    companyId: args.companyId,
    kind: args.kind,
    uploadedByUserId: getSessionUserId(args.session) || null,
    uploadedByName: getSessionUserName(args.session) || null,
    uploadedByEmail: getSessionUserEmail(args.session) || null,
    uploadedAt: new Date(),
    filename: safeString(args.filename) || `${args.kind}.pdf`,
    size: args.size,
    mimeType: "application/pdf",
  };
}

export async function findCompanyDocumentFile(
  db: Db,
  companyId: string,
  kind: CompanyDocumentKind,
) {
  const files = db.collection(`${COMPANY_DOCUMENT_BUCKET}.files`);
  return files.findOne({
    "metadata.companyId": companyId,
    "metadata.kind": kind,
  });
}

export function normalizeCompanyDocument(doc: any, kind?: CompanyDocumentKind | null) {
  if (!doc) return null;

  const resolvedKind = normalizeCompanyDocumentKind(kind ?? doc?.metadata?.kind);
  if (!resolvedKind) return null;

  return {
    fileId: mongoIdToString(doc?._id),
    filename: safeString(doc?.filename),
    fileName: safeString(doc?.filename),
    size:
      typeof doc?.length === "number" && Number.isFinite(doc.length)
        ? doc.length
        : Number(doc?.metadata?.size ?? 0) || 0,
    uploadedAt:
      doc?.metadata?.uploadedAt instanceof Date
        ? doc.metadata.uploadedAt.toISOString()
        : safeString(doc?.metadata?.uploadedAt) || null,
    url: getCompanyDocumentDownloadUrl(resolvedKind),
  };
}

export async function getCompanyDocumentsMap(db: Db, companyId: string) {
  const files = db.collection(`${COMPANY_DOCUMENT_BUCKET}.files`);
  const docs = await files
    .find({
      "metadata.companyId": companyId,
      "metadata.kind": { $in: [...COMPANY_DOCUMENT_KINDS] },
    })
    .sort({ uploadDate: -1, _id: -1 })
    .toArray();

  const byKind = new Map<CompanyDocumentKind, any>();
  for (const doc of docs) {
    const kind = normalizeCompanyDocumentKind(doc?.metadata?.kind);
    if (kind && !byKind.has(kind)) {
      byKind.set(kind, doc);
    }
  }

  return {
    agb: normalizeCompanyDocument(byKind.get("agb"), "agb"),
  };
}

function signPublicDocumentPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createPublicCompanyDocumentToken(args: {
  companyId: string;
  fileId: string;
  kind: CompanyDocumentKind;
  secret: string;
}) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    companyId: args.companyId,
    fileId: args.fileId,
    kind: args.kind,
  })).toString("base64url");
  return `${payload}.${signPublicDocumentPayload(payload, args.secret)}`;
}

export function verifyPublicCompanyDocumentToken(token: unknown, secret: string) {
  const [payload, signature] = safeString(token).split(".");
  if (!payload || !signature) return null;
  const expected = signPublicDocumentPayload(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const kind = normalizeCompanyDocumentKind(parsed?.kind);
    const companyId = safeString(parsed?.companyId);
    const fileId = safeString(parsed?.fileId);
    if (parsed?.v !== 1 || !kind || !companyId || !ObjectId.isValid(fileId)) return null;
    return { companyId, fileId, kind };
  } catch {
    return null;
  }
}

export function getPublicCompanyDocumentUrl(args: {
  baseUrl: string;
  companyId: string;
  document: any;
  secret: string;
}) {
  const fileId = safeString(args.document?.fileId);
  if (!fileId) return null;
  const token = createPublicCompanyDocumentToken({
    companyId: args.companyId,
    fileId,
    kind: "agb",
    secret: args.secret,
  });
  return `${args.baseUrl.replace(/\/$/, "")}/api/public/company-document/${encodeURIComponent(token)}`;
}

async function readNodeStreamToBuffer(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function downloadCompanyDocumentBuffer(
  db: Db,
  companyId: string,
  kind: CompanyDocumentKind,
) {
  const file = await findCompanyDocumentFile(db, companyId, kind);
  if (!file?._id) return null;

  const bucket = getCompanyDocumentsBucket(db);
  const stream = bucket.openDownloadStream(file._id as ObjectId);
  const buffer = await readNodeStreamToBuffer(stream);

  return {
    file,
    buffer,
  };
}

export async function uploadCompanyDocument(args: {
  db: Db;
  companyId: string;
  kind: CompanyDocumentKind;
  file: File;
  session: SessionPayload;
}) {
  if (safeString(args.file.type).toLowerCase() !== "application/pdf") {
    throw new Error("Nur PDF-Dateien sind erlaubt.");
  }

  if (args.file.size > COMPANY_DOCUMENT_MAX_BYTES) {
    throw new Error("Datei überschreitet 10 MB.");
  }

  const buffer = Buffer.from(await args.file.arrayBuffer());
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Nur gültige PDF-Dateien sind erlaubt.");
  }

  const existing = await findCompanyDocumentFile(args.db, args.companyId, args.kind);
  const bucket = getCompanyDocumentsBucket(args.db);
  if (existing?._id) {
    await bucket.delete(existing._id as ObjectId);
  }

  const filename = safeString(args.file.name) || `${args.kind}.pdf`;
  const metadata = buildCompanyDocumentMetadata({
    companyId: args.companyId,
    kind: args.kind,
    filename,
    size: args.file.size,
    session: args.session,
  });
  const uploadStream = bucket.openUploadStream(filename, {
    metadata,
  });

  await new Promise<void>((resolve, reject) => {
    uploadStream.once("error", reject);
    uploadStream.once("finish", () => resolve());
    Readable.from(buffer).pipe(uploadStream);
  });

  const stored = await findCompanyDocumentFile(args.db, args.companyId, args.kind);
  return normalizeCompanyDocument(stored, args.kind);
}

export async function deleteCompanyDocument(
  db: Db,
  companyId: string,
  kind: CompanyDocumentKind,
) {
  const existing = await findCompanyDocumentFile(db, companyId, kind);
  if (!existing?._id) return false;

  const bucket = getCompanyDocumentsBucket(db);
  await bucket.delete(existing._id as ObjectId);
  return true;
}

export async function createCompanyDocumentDownloadResponse(args: {
  db: Db;
  companyId: string;
  kind: CompanyDocumentKind;
}) {
  const file = await findCompanyDocumentFile(args.db, args.companyId, args.kind);
  if (!file?._id) {
    return null;
  }

  const bucket = getCompanyDocumentsBucket(args.db);
  const stream = bucket.openDownloadStream(file._id as ObjectId);
  const filename = safeString(file?.filename) || `${args.kind}.pdf`;

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function createPublicCompanyDocumentDownloadResponse(args: {
  db: Db;
  token: string;
  secret: string;
}) {
  const verified = verifyPublicCompanyDocumentToken(args.token, args.secret);
  if (!verified) return null;
  const file = await args.db.collection(`${COMPANY_DOCUMENT_BUCKET}.files`).findOne({
    _id: new ObjectId(verified.fileId),
    "metadata.companyId": verified.companyId,
    "metadata.kind": verified.kind,
  });
  if (!file?._id) return null;
  const stream = getCompanyDocumentsBucket(args.db).openDownloadStream(file._id as ObjectId);
  const filename = safeString(file?.filename) || "agb.pdf";
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function companyIdToObjectId(companyId: string) {
  const objectId = toObjectIdOrNull(companyId);
  if (!objectId) {
    throw new Error("Ungültige Firmen-ID.");
  }
  return objectId;
}
