import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { safeString, type SessionPayload } from "@/lib/api-session";
import { getSessionUserId, getSessionUserName, isAdminLikeRole } from "@/lib/tasks";

export type PlanningComment = {
  id: string;
  text: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
};

export type PlanningStageHistoryEntry = {
  stage: string;
  at: string;
  by: string | null;
  byName: string | null;
};

let ensurePlanningIndexesPromise: Promise<void> | null = null;
let ensurePlanningStageHistoryMigrationPromise: Promise<void> | null = null;

export function normalizePlanningComment(comment: any): PlanningComment {
  const rawId = comment?.id;
  const id =
    typeof rawId === "string"
      ? rawId
      : rawId instanceof ObjectId
        ? rawId.toString()
        : safeString(rawId);

  return {
    id,
    text: safeString(comment?.text),
    createdByUserId: safeString(comment?.createdByUserId),
    createdByName: safeString(comment?.createdByName),
    createdAt: safeString(comment?.createdAt),
  };
}

export function normalizePlanningComments(comments: unknown) {
  if (!Array.isArray(comments)) return [] as PlanningComment[];

  return comments
    .map((comment) => normalizePlanningComment(comment))
    .filter((comment) => comment.id && comment.text);
}

export function buildPlanningComment(
  text: string,
  session: SessionPayload,
): PlanningComment {
  return {
    id: new ObjectId().toString(),
    text: safeString(text),
    createdByUserId: getSessionUserId(session),
    createdByName: getSessionUserName(session) || "unknown",
    createdAt: new Date().toISOString(),
  };
}

export function canDeletePlanningComment(
  comment: any,
  session: SessionPayload | null | undefined,
) {
  const currentUserId = getSessionUserId(session);
  if (!currentUserId) return false;
  if (isAdminLikeRole(session)) return true;
  return safeString(comment?.createdByUserId) === currentUserId;
}

export function buildInitialStageHistoryEntry(planning: any): PlanningStageHistoryEntry {
  const createdAtValue = planning?.createdAt;
  const at =
    typeof createdAtValue?.toISOString === "function"
      ? createdAtValue.toISOString()
      : safeString(createdAtValue) || new Date().toISOString();

  return {
    stage: safeString(planning?.commercial?.stage) || "lead",
    at,
    by: safeString(planning?.createdByUserId) || null,
    byName: safeString(planning?.createdByName) || "unknown",
  };
}

export function normalizeStageHistory(history: unknown) {
  if (!Array.isArray(history)) return [] as PlanningStageHistoryEntry[];

  return history
    .map((entry) => ({
      stage: safeString((entry as any)?.stage) || "lead",
      at: safeString((entry as any)?.at),
      by: safeString((entry as any)?.by) || null,
      byName: safeString((entry as any)?.byName) || null,
    }))
    .filter((entry) => entry.stage && entry.at);
}

export function buildStageHistoryForTransition(
  planning: any,
  nextStage: string,
  session: SessionPayload,
) {
  const normalizedNextStage = safeString(nextStage) || "lead";
  const currentStage = safeString(planning?.commercial?.stage) || "lead";
  const existingHistory = normalizeStageHistory(planning?.commercial?.stageHistory);
  const history =
    existingHistory.length > 0
      ? existingHistory
      : [buildInitialStageHistoryEntry(planning)];

  if (currentStage === normalizedNextStage) {
    return history;
  }

  return [
    ...history,
    {
      stage: normalizedNextStage,
      at: new Date().toISOString(),
      by: getSessionUserId(session) || null,
      byName: getSessionUserName(session) || "unknown",
    },
  ];
}

export async function ensurePlanningIndexes(db: Db) {
  if (ensurePlanningIndexesPromise) {
    return ensurePlanningIndexesPromise;
  }

  ensurePlanningIndexesPromise = (async () => {
    const plannings = db.collection("plannings");
    await plannings.createIndex({ companyId: 1, "commercial.stage": 1 });
  })().catch((error) => {
    ensurePlanningIndexesPromise = null;
    throw error;
  });

  return ensurePlanningIndexesPromise;
}

export async function ensurePlanningStageHistoryMigration(db: Db) {
  if (ensurePlanningStageHistoryMigrationPromise) {
    return ensurePlanningStageHistoryMigrationPromise;
  }

  ensurePlanningStageHistoryMigrationPromise = (async () => {
    const plannings = db.collection("plannings");
    const docs = await plannings
      .find(
        {
          $or: [
            { "commercial.stageHistory": { $exists: false } },
            { "commercial.stageHistory": null },
            { "commercial.stageHistory": { $size: 0 } },
          ],
        },
        {
          projection: {
            _id: 1,
            createdAt: 1,
            createdByUserId: 1,
            createdByName: 1,
            commercial: 1,
          },
        },
      )
      .toArray();

    if (!docs.length) return;

    await plannings.bulkWrite(
      docs.map((doc: any) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              "commercial.stageHistory": [buildInitialStageHistoryEntry(doc)],
            },
          },
        },
      })),
    );
  })().catch((error) => {
    ensurePlanningStageHistoryMigrationPromise = null;
    throw error;
  });

  return ensurePlanningStageHistoryMigrationPromise;
}

