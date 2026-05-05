import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { safeString, type SessionPayload } from "@/lib/api-session";
import { getSessionUserId, getSessionUserName, isAdminLikeRole } from "@/lib/tasks";
import { CHECKLIST_ITEMS, CHECKLIST_ITEM_MAP, type ChecklistItemKey } from "@/lib/checklistCatalog";

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

export type PlanningChecklistItem = {
  key: ChecklistItemKey;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  doneByName: string | null;
  note?: string | null;
};

export type PlanningChecklist = {
  items: PlanningChecklistItem[];
  updatedAt: string;
};

export type PlanningChecklistHistoryEntry = {
  itemKey: ChecklistItemKey;
  label: string;
  done: boolean;
  at: string;
  by: string | null;
  byName: string | null;
};

let ensurePlanningIndexesPromise: Promise<void> | null = null;
let ensurePlanningStageHistoryMigrationPromise: Promise<void> | null = null;
let ensurePlanningChecklistMigrationPromise: Promise<void> | null = null;

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

export function buildDefaultChecklistItem(key: ChecklistItemKey): PlanningChecklistItem {
  return {
    key,
    done: false,
    doneAt: null,
    doneBy: null,
    doneByName: null,
    note: null,
  };
}

export function buildDefaultChecklist(updatedAt?: string | Date | null): PlanningChecklist {
  const at =
    typeof updatedAt === "string"
      ? updatedAt
      : updatedAt instanceof Date
        ? updatedAt.toISOString()
        : new Date().toISOString();

  return {
    items: CHECKLIST_ITEMS.map((item) => buildDefaultChecklistItem(item.key)),
    updatedAt: at,
  };
}

export function normalizePlanningChecklistItem(input: any): PlanningChecklistItem | null {
  const key = safeString(input?.key) as ChecklistItemKey;
  if (!CHECKLIST_ITEM_MAP.has(key)) return null;

  const doneAtRaw = input?.doneAt;
  const doneAt =
    typeof doneAtRaw?.toISOString === "function"
      ? doneAtRaw.toISOString()
      : safeString(doneAtRaw) || null;

  return {
    key,
    done: !!input?.done,
    doneAt,
    doneBy: safeString(input?.doneBy) || null,
    doneByName: safeString(input?.doneByName) || null,
    note:
      input?.note == null
        ? null
        : safeString(input?.note).slice(0, 4000) || null,
  };
}

export function normalizePlanningChecklist(checklist: any): PlanningChecklist {
  const normalizedItems = new Map<ChecklistItemKey, PlanningChecklistItem>();

  if (Array.isArray(checklist?.items)) {
    for (const rawItem of checklist.items) {
      const item = normalizePlanningChecklistItem(rawItem);
      if (item) {
        normalizedItems.set(item.key, item);
      }
    }
  }

  const items = CHECKLIST_ITEMS.map((catalogItem) => {
    return normalizedItems.get(catalogItem.key) ?? buildDefaultChecklistItem(catalogItem.key);
  });

  const updatedAtRaw = checklist?.updatedAt;
  const updatedAt =
    typeof updatedAtRaw?.toISOString === "function"
      ? updatedAtRaw.toISOString()
      : safeString(updatedAtRaw) || new Date().toISOString();

  return { items, updatedAt };
}

export function normalizeChecklistHistory(history: unknown) {
  if (!Array.isArray(history)) return [] as PlanningChecklistHistoryEntry[];

  return history
    .map((entry) => {
      const itemKey = safeString((entry as any)?.itemKey) as ChecklistItemKey;
      const catalogItem = CHECKLIST_ITEM_MAP.get(itemKey);
      if (!catalogItem) return null;

      const atRaw = (entry as any)?.at;
      const at =
        typeof atRaw?.toISOString === "function"
          ? atRaw.toISOString()
          : safeString(atRaw);

      if (!at) return null;

      return {
        itemKey,
        label: safeString((entry as any)?.label) || catalogItem.label,
        done: !!(entry as any)?.done,
        at,
        by: safeString((entry as any)?.by) || null,
        byName: safeString((entry as any)?.byName) || null,
      };
    })
    .filter((entry): entry is PlanningChecklistHistoryEntry => !!entry);
}

export function buildChecklistHistoryEvent(
  itemKey: ChecklistItemKey,
  done: boolean,
  session: SessionPayload,
): PlanningChecklistHistoryEntry {
  const catalogItem = CHECKLIST_ITEM_MAP.get(itemKey);
  const at = new Date().toISOString();
  return {
    itemKey,
    label: catalogItem?.label || itemKey,
    done,
    at,
    by: getSessionUserId(session) || null,
    byName: getSessionUserName(session) || null,
  };
}

export function updateChecklistItem(
  checklist: PlanningChecklist,
  itemKey: ChecklistItemKey,
  input: { done: boolean; note?: string | null },
  session: SessionPayload,
) {
  const event = buildChecklistHistoryEvent(itemKey, input.done, session);

  const items = checklist.items.map((item) => {
    if (item.key !== itemKey) return item;

    return {
      ...item,
      done: input.done,
      doneAt: input.done ? event.at : null,
      doneBy: input.done ? event.by : null,
      doneByName: input.done ? event.byName : null,
      note:
        "note" in input
          ? (input.note == null ? null : safeString(input.note).slice(0, 4000) || null)
          : item.note ?? null,
    };
  });

  return {
    checklist: {
      items,
      updatedAt: event.at,
    },
    event,
  };
}

export function applyChecklistBulk(
  existingChecklist: PlanningChecklist,
  items: Array<{ key: string; done: boolean }>,
  session?: SessionPayload,
) {
  const bulkAt = new Date().toISOString();
  const bulkBy = session ? getSessionUserId(session) || null : null;
  const bulkByName = session ? getSessionUserName(session) || null : null;
  const updates = new Map(
    items
      .map((item) => [safeString(item?.key), !!item?.done] as const)
      .filter(([key]) => CHECKLIST_ITEM_MAP.has(key as ChecklistItemKey)),
  );

  return {
    items: existingChecklist.items.map((item) =>
      updates.has(item.key)
        ? {
            ...item,
            done: !!updates.get(item.key),
            doneAt: updates.get(item.key)
              ? item.done
                ? item.doneAt || bulkAt
                : bulkAt
              : null,
            doneBy: updates.get(item.key)
              ? item.done
                ? item.doneBy || bulkBy
                : bulkBy
              : null,
            doneByName: updates.get(item.key)
              ? item.done
                ? item.doneByName || bulkByName
                : bulkByName
              : null,
          }
        : item,
    ),
    updatedAt: bulkAt,
  };
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

export async function ensurePlanningChecklistMigration(db: Db) {
  if (ensurePlanningChecklistMigrationPromise) {
    return ensurePlanningChecklistMigrationPromise;
  }

  ensurePlanningChecklistMigrationPromise = (async () => {
    const plannings = db.collection("plannings");
    const docs = await plannings
      .find(
        {
          $or: [
            { checklist: { $exists: false } },
            { checklist: null },
            { "checklist.items": { $exists: false } },
            { "checklist.items": { $size: 0 } },
          ],
        },
        { projection: { _id: 1, createdAt: 1 } },
      )
      .toArray();

    if (!docs.length) return;

    await plannings.bulkWrite(
      docs.map((doc: any) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              checklist: buildDefaultChecklist(doc?.createdAt),
            },
          },
        },
      })),
    );
  })().catch((error) => {
    ensurePlanningChecklistMigrationPromise = null;
    throw error;
  });

  return ensurePlanningChecklistMigrationPromise;
}
