import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
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

export const TRASH_TYPES = ["planning", "customer", "task"] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export type TrashPermissions = {
  canViewTrash: boolean;
  canRestore: boolean;
  canPermanentDelete: boolean;
};

export function noStoreHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...noStoreHeaders(origin),
    },
  });
}

export function activeDocumentFilter() {
  return {
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  };
}

export function deletedDocumentFilter() {
  return {
    deletedAt: { $exists: true, $ne: null },
  };
}

export function getTrashPermissions(
  session: SessionPayload | null | undefined,
): TrashPermissions {
  const allowed = isAdminLikeRole(session);
  return {
    canViewTrash: allowed,
    canRestore: allowed,
    canPermanentDelete: allowed,
  };
}

export function normalizeTrashType(value: unknown): TrashType | null {
  const normalized = safeString(value).toLowerCase() as TrashType;
  return TRASH_TYPES.includes(normalized) ? normalized : null;
}

function serializeValue(value: any): any {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]),
    );
  }
  return value;
}

function buildPlanningTitle(doc: any) {
  return (
    safeString(doc?.title) ||
    safeString(doc?.summary?.customerName) ||
    safeString(doc?.data?.profile?.businessName) ||
    [
      safeString(doc?.data?.profile?.contactFirstName),
      safeString(doc?.data?.profile?.contactLastName),
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Unbenanntes Projekt"
  );
}

function buildPlanningSubtitle(doc: any) {
  const parts = [
    safeString(doc?.planningNumber),
    safeString(doc?.summary?.customerName),
    safeString(doc?.data?.planner?.snapshot?.address),
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildCustomerTitle(doc: any) {
  return (
    safeString(doc?.name) ||
    safeString(doc?.companyName) ||
    [safeString(doc?.firstName), safeString(doc?.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Unbenannter Kunde"
  );
}

function buildCustomerSubtitle(doc: any) {
  const parts = [safeString(doc?.email), safeString(doc?.address)].filter(Boolean);
  return parts.join(" · ");
}

function buildTaskTitle(doc: any) {
  return safeString(doc?.title) || "Unbenannte Aufgabe";
}

function buildTaskSubtitle(doc: any) {
  const parts = [
    safeString(doc?.description),
    safeString(doc?.assignedToName),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function normalizeTrashItem(type: TrashType, doc: any) {
  const title =
    type === "planning"
      ? buildPlanningTitle(doc)
      : type === "customer"
        ? buildCustomerTitle(doc)
        : buildTaskTitle(doc);

  const subtitle =
    type === "planning"
      ? buildPlanningSubtitle(doc)
      : type === "customer"
        ? buildCustomerSubtitle(doc)
        : buildTaskSubtitle(doc);

  return {
    id: mongoIdToString(doc?._id),
    type,
    title,
    ...(subtitle ? { subtitle } : {}),
    deletedAt:
      doc?.deletedAt instanceof Date
        ? doc.deletedAt.toISOString()
        : safeString(doc?.deletedAt),
    ...(safeString(doc?.deletedByName)
      ? { deletedByName: safeString(doc?.deletedByName) }
      : {}),
    ...(safeString(doc?.deletedByEmail)
      ? { deletedByEmail: safeString(doc?.deletedByEmail) }
      : {}),
    original: serializeValue(doc),
  };
}

export function buildSoftDeleteFields(session: SessionPayload) {
  const now = new Date();
  return {
    deletedAt: now,
    deletedByUserId: getSessionUserId(session) || null,
    deletedByName: getSessionUserName(session) || null,
    deletedByEmail: getSessionUserEmail(session) || null,
    updatedAt: now,
  };
}

export function buildRestoreUnsetFields() {
  return {
    deletedAt: "",
    deletedByUserId: "",
    deletedByName: "",
    deletedByEmail: "",
    deletedCascadeParentType: "",
    deletedCascadeParentId: "",
  };
}

export function getCollectionForType(db: Db, type: TrashType) {
  if (type === "planning") return db.collection("plannings");
  if (type === "customer") return db.collection("customers");
  return db.collection("tasks");
}

export function getScopedTrashFilter(
  type: TrashType,
  id: string,
  activeCompanyId: string,
) {
  const objectId = toObjectIdOrNull(id);
  if (!objectId) return null;

  return {
    _id: objectId,
    companyId: activeCompanyId,
    ...deletedDocumentFilter(),
  };
}
