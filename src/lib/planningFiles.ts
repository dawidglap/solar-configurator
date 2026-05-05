import crypto from "crypto";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import {
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import {
  getSessionUserEmail,
  getSessionUserId,
  getSessionUserName,
  isAdminLikeRole,
  jsonResponse,
  noStoreHeaders,
} from "@/lib/tasks";
import { activeDocumentFilter } from "@/lib/trash";
import { getCloudinary, hasCloudinaryEnv, uploadBufferToCloudinary } from "@/lib/cloudinary";

export const PLANNING_FILE_CATEGORIES = [
  "offer",
  "planning",
  "document",
  "photo",
] as const;

export const PLANNING_FILE_TYPES = [
  "image",
  "pdf",
  "document",
  "spreadsheet",
  "other",
] as const;

type PlanningFileCategory = (typeof PLANNING_FILE_CATEGORIES)[number];
type PlanningFileType = (typeof PLANNING_FILE_TYPES)[number];

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function normalizePlanningFileCategory(value: unknown): PlanningFileCategory | null {
  const normalized = safeString(value).toLowerCase() as PlanningFileCategory;
  return PLANNING_FILE_CATEGORIES.includes(normalized) ? normalized : null;
}

export function isAllowedPlanningFileMimeType(value: unknown) {
  return ALLOWED_MIME_TYPES.has(safeString(value).toLowerCase());
}

export function getPlanningFileTypeFromMimeType(mimeType: string): PlanningFileType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (
    [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(mimeType)
  ) {
    return "document";
  }
  if (
    [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(mimeType)
  ) {
    return "spreadsheet";
  }
  return "other";
}

export function getPlanningFileCloudinaryResourceType(
  mimeType: string,
): "image" | "raw" | "video" {
  return mimeType.startsWith("image/") ? "image" : "raw";
}

export function sanitizeFilenameBase(value: string) {
  return (
    safeString(value)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase() || "file"
  );
}

export function stripFileExtension(value: string) {
  const name = safeString(value);
  return name.replace(/\.[^.]+$/, "") || name;
}

export function buildCloudinaryFolder(
  companyId: string,
  planningId: string,
  category: PlanningFileCategory,
) {
  return `sola/${companyId}/plannings/${planningId}/${category}`;
}

export function buildCloudinaryPublicId(originalFileName: string) {
  const base = sanitizeFilenameBase(stripFileExtension(originalFileName));
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${timestamp}-${random}-${base}`;
}

export function buildThumbnailUrl(result: any, resourceType: "image" | "raw" | "video") {
  if (resourceType !== "image") return null;
  try {
    const sdk = getCloudinary();
    return sdk.url(result.public_id, {
      secure: true,
      resource_type: "image",
      transformation: [
        {
          width: 400,
          height: 300,
          crop: "fill",
          quality: "auto",
          fetch_format: "auto",
        },
      ],
    });
  } catch {
    return null;
  }
}

export function getPlanningFilePermissions(session: SessionPayload | null | undefined) {
  const canManage = isAdminLikeRole(session);
  return {
    canUpload: canManage,
    canDelete: canManage,
  };
}

export function normalizePlanningFile(doc: any) {
  return {
    id: mongoIdToString(doc?._id),
    companyId: safeString(doc?.companyId),
    planningId: safeString(doc?.planningId),
    ...(safeString(doc?.customerId) ? { customerId: safeString(doc?.customerId) } : {}),
    category: normalizePlanningFileCategory(doc?.category) ?? "document",
    title: safeString(doc?.title),
    originalFileName: safeString(doc?.originalFileName),
    fileType: (safeString(doc?.fileType) || "other") as PlanningFileType,
    mimeType: safeString(doc?.mimeType),
    sizeBytes:
      typeof doc?.sizeBytes === "number" && Number.isFinite(doc.sizeBytes)
        ? doc.sizeBytes
        : 0,
    cloudinaryPublicId: safeString(doc?.cloudinaryPublicId),
    cloudinaryResourceType:
      (safeString(doc?.cloudinaryResourceType) || "raw") as "image" | "raw" | "video",
    cloudinaryUrl: safeString(doc?.cloudinaryUrl),
    cloudinarySecureUrl: safeString(doc?.cloudinarySecureUrl),
    ...(safeString(doc?.thumbnailUrl) ? { thumbnailUrl: safeString(doc?.thumbnailUrl) } : {}),
    uploadedByUserId: safeString(doc?.uploadedByUserId),
    uploadedByName: safeString(doc?.uploadedByName),
    ...(safeString(doc?.uploadedByEmail) ? { uploadedByEmail: safeString(doc?.uploadedByEmail) } : {}),
    createdAt: safeString(doc?.createdAt),
    updatedAt: safeString(doc?.updatedAt),
  };
}

export async function ensurePlanningFileIndexes(db: Db) {
  const collection = db.collection("planningFiles");
  await Promise.all([
    collection.createIndex({
      companyId: 1,
      planningId: 1,
      isDeleted: 1,
      category: 1,
      createdAt: -1,
    }),
    collection.createIndex({
      companyId: 1,
      isDeleted: 1,
      deletedAt: -1,
    }),
  ]);
}

export async function getPlanningByIdForCompany(
  db: Db,
  planningId: string,
  companyId: string,
) {
  const objectId = toObjectIdOrNull(planningId);
  if (!objectId) return null;

  return db.collection("plannings").findOne({
    _id: objectId,
    companyId,
    ...activeDocumentFilter(),
  });
}

export async function assertCompanyScopedPlanning(
  db: Db,
  planningId: string,
  companyId: string,
) {
  const planning = await getPlanningByIdForCompany(db, planningId, companyId);
  return planning;
}

export function extractPlanningFileCustomerId(planning: any) {
  return safeString(planning?.customerId) || undefined;
}

export function getPlanningFilesCollection(db: Db) {
  return db.collection("planningFiles");
}

export function createPlanningFileNoStoreHeaders(origin: string | null) {
  return noStoreHeaders(origin);
}

export function createPlanningFileJsonResponse(origin: string | null, body: any, status = 200) {
  return jsonResponse(origin, body, status);
}

export function getPlanningFileSessionUser(session: SessionPayload | null | undefined) {
  return {
    userId: getSessionUserId(session),
    name: getSessionUserName(session),
    email: getSessionUserEmail(session),
  };
}

export function validatePlanningFileAccess(session: SessionPayload | null | undefined) {
  return {
    activeCompanyId: safeString(session?.activeCompanyId),
    canManage: isAdminLikeRole(session),
  };
}

export async function parseAndUploadPlanningFile(input: {
  companyId: string;
  planningId: string;
  category: PlanningFileCategory;
  file: File;
  title?: string;
  customerId?: string;
  session: SessionPayload;
}) {
  if (!hasCloudinaryEnv()) {
    throw new Error("Missing Cloudinary environment variables");
  }

  const originalFileName = safeString(input.file.name) || "upload";
  const mimeType = safeString(input.file.type).toLowerCase();

  if (!isAllowedPlanningFileMimeType(mimeType)) {
    throw new Error("Unsupported file type");
  }

  if (input.file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File exceeds 10 MB limit");
  }

  const resourceType = getPlanningFileCloudinaryResourceType(mimeType);
  const fileType = getPlanningFileTypeFromMimeType(mimeType);
  const folder = buildCloudinaryFolder(input.companyId, input.planningId, input.category);
  const publicId = buildCloudinaryPublicId(originalFileName);
  const buffer = Buffer.from(await input.file.arrayBuffer());

  const upload = await uploadBufferToCloudinary({
    buffer,
    folder,
    publicId,
    resourceType,
    mimeType,
    originalFilename: originalFileName,
  });

  const now = new Date().toISOString();
  const uploadedBy = getPlanningFileSessionUser(input.session);

  const doc = {
    companyId: input.companyId,
    planningId: input.planningId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    category: input.category,
    title: safeString(input.title) || stripFileExtension(originalFileName) || originalFileName,
    originalFileName,
    fileType,
    mimeType,
    sizeBytes: input.file.size,
    cloudinaryPublicId: safeString(upload?.public_id),
    cloudinaryResourceType: resourceType,
    cloudinaryUrl: safeString(upload?.url),
    cloudinarySecureUrl: safeString(upload?.secure_url),
    thumbnailUrl: buildThumbnailUrl(upload, resourceType),
    uploadedByUserId: uploadedBy.userId,
    uploadedByName: uploadedBy.name,
    ...(uploadedBy.email ? { uploadedByEmail: uploadedBy.email } : {}),
    isDeleted: false,
    deletedAt: null,
    deletedByUserId: null,
    deletedByName: null,
    createdAt: now,
    updatedAt: now,
  };

  return doc;
}

export async function getPlanningFileDbAndSession(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return {
      ok: false as const,
      response: createPlanningFileJsonResponse(
        origin,
        { ok: false, error: "Missing SESSION_SECRET" },
        500,
      ),
    };
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return {
      ok: false as const,
      response: createPlanningFileJsonResponse(
        origin,
        { ok: false, error: "Not logged in" },
        401,
      ),
    };
  }

  const db = await getDb();
  return {
    ok: true as const,
    origin,
    session,
    db,
    companyId: safeString(session.activeCompanyId),
  };
}

export function buildPlanningFileFilter(companyId: string, planningId: string) {
  return {
    companyId,
    planningId,
    isDeleted: { $ne: true },
  };
}

export function buildPlanningFileDeletePatch(session: SessionPayload) {
  const now = new Date().toISOString();
  return {
    isDeleted: true,
    deletedAt: now,
    deletedByUserId: getSessionUserId(session) || null,
    deletedByName: getSessionUserName(session) || null,
    updatedAt: now,
  };
}

