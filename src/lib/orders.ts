import type { Db } from "mongodb";
import { ObjectId, ReturnDocument } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { getSessionUserMeta, isAdminLikeRole } from "@/lib/tasks";

export function canManageCompanyBank(session: SessionPayload | null | undefined) {
  return isAdminLikeRole(session);
}

export function canGenerateOrders(session: SessionPayload | null | undefined) {
  if (isAdminLikeRole(session)) return true;

  const roles = [
    (session as any)?.activeRole,
    (session as any)?.role,
    (session as any)?.activeCompanyRole,
    (session as any)?.membershipRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);

  return roles.some((role) => ["sales", "seller", "verkauf", "planner"].includes(role));
}

export async function nextOrderId(db: Db, companyId: string, now = new Date()) {
  const year = now.getFullYear();
  const counters = db.collection("counters");
  const result = await counters.findOneAndUpdate(
    {
      companyId,
      year,
      type: "auftrag",
    },
    {
      $inc: { seq: 1 },
      $setOnInsert: {
        companyId,
        year,
        type: "auftrag",
        createdAt: now,
      },
      $set: {
        updatedAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: ReturnDocument.AFTER,
    },
  );

  const seq = Number((result as any)?.seq ?? (result as any)?.value?.seq ?? 0);
  const padded = String(seq).padStart(4, "0");
  return `AUF-${year}-${padded}`;
}

export function normalizeOrderFields(planning: any) {
  return {
    orderStatus: safeString(planning?.orderStatus) || "none",
    orderId: safeString(planning?.orderId) || null,
    orderGeneratedAt:
      planning?.orderGeneratedAt instanceof Date
        ? planning.orderGeneratedAt.toISOString()
        : safeString(planning?.orderGeneratedAt) || null,
    orderGeneratedByUserId:
      mongoIdToString(planning?.orderGeneratedByUserId) ||
      safeString(planning?.orderGeneratedByUserId) ||
      null,
    orderGeneratedByName: safeString(planning?.orderGeneratedByName) || null,
    commercialLockedAt:
      planning?.commercialLockedAt instanceof Date
        ? planning.commercialLockedAt.toISOString()
        : safeString(planning?.commercialLockedAt) || null,
    orderSnapshotFileId:
      mongoIdToString(planning?.orderSnapshotFileId) ||
      safeString(planning?.orderSnapshotFileId) ||
      null,
    angebotSnapshotFileId:
      mongoIdToString(planning?.angebotSnapshotFileId) ||
      safeString(planning?.angebotSnapshotFileId) ||
      null,
    cancelledAt:
      planning?.cancelledAt instanceof Date
        ? planning.cancelledAt.toISOString()
        : safeString(planning?.cancelledAt) || null,
    cancelledByUserId:
      mongoIdToString(planning?.cancelledByUserId) ||
      safeString(planning?.cancelledByUserId) ||
      null,
    cancelledByName: safeString(planning?.cancelledByName) || null,
    cancelReason: safeString(planning?.cancelReason) || null,
  };
}

export function buildOrderAuditFields(session: SessionPayload | null | undefined) {
  const meta = getSessionUserMeta(session);
  return {
    orderGeneratedByUserId: toObjectIdOrNull(meta.id) || meta.id || null,
    orderGeneratedByName: meta.name || "Unbekannt",
  };
}

export function toCompanyObjectId(companyId: string) {
  const objectId = toObjectIdOrNull(companyId);
  if (!objectId) {
    throw new Error("Ungültige Firmen-ID.");
  }
  return objectId;
}

export function toPlanningObjectId(planningId: string) {
  const objectId = toObjectIdOrNull(planningId);
  if (!objectId) {
    throw new Error("Ungültige Planning-ID.");
  }
  return objectId;
}
