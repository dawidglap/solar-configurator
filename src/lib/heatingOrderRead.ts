import type { Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { resolveProjectType } from "@/lib/projectType";
import { activeDocumentFilter } from "@/lib/trash";

export type HeatingOrderReadResult =
  | { kind: "not_found" }
  | { kind: "not_heating" }
  | { kind: "inconsistent"; message: string }
  | {
      kind: "ok";
      response: {
        ok: true;
        planningId: string;
        exists: boolean;
        order: ReturnType<typeof serializeHeatingOrder> | null;
      };
    };

function iso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = safeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function serializeHeatingOrder(doc: any) {
  return {
    auftragId: mongoIdToString(doc?._id),
    orderId: safeString(doc?.orderId),
    projectType: "heating" as const,
    status: safeString(doc?.status),
    currentStepKey: safeString(doc?.currentStepKey) || null,
    createdAt: iso(doc?.createdAt),
    updatedAt: iso(doc?.updatedAt),
    contractTotalGrossChf: doc?.contractTotalGrossChf,
    currency: safeString(doc?.currency),
    heatingOrderSnapshot: doc?.heatingOrderSnapshot,
    issuedOfferSnapshotFileId: mongoIdToString(doc?.issuedOfferSnapshotFileId) || null,
    signedOfferFileId: mongoIdToString(doc?.signedOfferFileId) || null,
    orderSnapshotFileId: mongoIdToString(doc?.orderSnapshotFileId) || null,
  };
}

export async function readCanonicalHeatingOrder(args: {
  db: Db;
  companyId: string;
  planningId: string;
}): Promise<HeatingOrderReadResult> {
  const planningObjectId = toObjectIdOrNull(args.planningId);
  const companyObjectId = toObjectIdOrNull(args.companyId);
  if (!planningObjectId || !companyObjectId) return { kind: "not_found" };

  const planning = await args.db.collection<any>("plannings").findOne({
    _id: planningObjectId,
    companyId: args.companyId,
    ...activeDocumentFilter(),
  });
  if (!planning) return { kind: "not_found" };

  try {
    if (resolveProjectType(planning.projectType) !== "heating") {
      return { kind: "not_heating" };
    }
  } catch {
    return { kind: "not_heating" };
  }

  const auftrag = await args.db.collection<any>("auftraege").findOne({
    companyId: companyObjectId,
    planningId: planningObjectId,
    projectType: "heating",
  });
  if (!auftrag) {
    return {
      kind: "ok",
      response: { ok: true, planningId: args.planningId, exists: false, order: null },
    };
  }

  const planningOrderId = safeString(planning.orderId);
  const auftragOrderId = safeString(auftrag.orderId);
  if (!planningOrderId || !auftragOrderId || planningOrderId !== auftragOrderId) {
    return { kind: "inconsistent", message: "Heating-Auftrag und Planung sind inkonsistent." };
  }

  const snapshot = auftrag.heatingOrderSnapshot;
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    snapshot.projectType !== "heating" ||
    safeString(snapshot.planningId) !== args.planningId
  ) {
    return { kind: "inconsistent", message: "Heating-Auftragssnapshot ist inkonsistent." };
  }

  return {
    kind: "ok",
    response: {
      ok: true,
      planningId: args.planningId,
      exists: true,
      order: serializeHeatingOrder(auftrag),
    },
  };
}
