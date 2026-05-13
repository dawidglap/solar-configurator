import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  buildIdVariants,
  getCompanyMembersByIds,
  getSessionUserId,
  getSessionUserName,
  isAdminLikeRole,
} from "@/lib/tasks";
import { extractAddressFromPlanning } from "@/lib/montages";

export const EXECUTION_TRACKS = ["montage", "elektro"] as const;
export const EXECUTION_STAGES = [
  "offen",
  "geplant",
  "in_ausfuehrung",
  "abgeschlossen",
] as const;

export type ExecutionTrack = (typeof EXECUTION_TRACKS)[number];
export type ExecutionStage = (typeof EXECUTION_STAGES)[number];

type NormalizedExecutionAssignee = {
  id: string;
  fullName: string;
  email: string;
  executionRoles: ExecutionTrack[];
};

type NormalizedExecutionTask = {
  id: string;
  companyId: string;
  projectId: string;
  planningId: string;
  customerId: string | null;
  track: ExecutionTrack;
  stage: ExecutionStage;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startTime: string | null;
  endTime: string | null;
  assignedUserIds: string[];
  assignees: NormalizedExecutionAssignee[];
  address: {
    street: string;
    zip: string;
    city: string;
    country: string;
  };
  notes: string;
  stageHistory: Array<{ stage: ExecutionStage; at: string; by: string | null }>;
  customerName?: string;
  planningTitle?: string;
  projectNumber?: string;
  createdAt: string;
  updatedAt: string;
};

let ensureExecutionTaskIndexesPromise: Promise<void> | null = null;

export function isExecutionTrack(value: unknown): value is ExecutionTrack {
  return EXECUTION_TRACKS.includes(value as ExecutionTrack);
}

export function isExecutionStage(value: unknown): value is ExecutionStage {
  return EXECUTION_STAGES.includes(value as ExecutionStage);
}

export function normalizeExecutionTrack(value: unknown): ExecutionTrack | null {
  const normalized = safeString(value).toLowerCase();
  return isExecutionTrack(normalized) ? normalized : null;
}

export function normalizeExecutionStage(value: unknown): ExecutionStage | null {
  const normalized = safeString(value).toLowerCase();
  return isExecutionStage(normalized) ? normalized : null;
}

export function normalizeExecutionRoles(input: unknown): ExecutionTrack[] {
  const values = Array.isArray(input)
    ? input.map((value) => normalizeExecutionTrack(value)).filter(Boolean)
    : [];
  return Array.from(new Set(values)) as ExecutionTrack[];
}

export function normalizeExecutionAddress(address: any) {
  return {
    street: safeString(address?.street),
    zip: safeString(address?.zip),
    city: safeString(address?.city),
    country: safeString(address?.country) || "CH",
  };
}

export function normalizeExecutionDate(value: unknown) {
  if (value == null || value === "") return null;
  const raw = safeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

export function normalizeExecutionTime(value: unknown) {
  if (value == null || value === "") return null;
  const raw = safeString(value);
  if (!raw) return null;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) return undefined;
  return raw;
}

export function getExecutionTasksCollection(db: Db) {
  return db.collection("executionTasks");
}

export async function ensureExecutionTaskIndexes(db: Db) {
  if (ensureExecutionTaskIndexesPromise) return ensureExecutionTaskIndexesPromise;

  const executionTasks = getExecutionTasksCollection(db);
  ensureExecutionTaskIndexesPromise = Promise.all([
    executionTasks.createIndex({ companyId: 1, track: 1, stage: 1 }),
    executionTasks.createIndex(
      { companyId: 1, projectId: 1, track: 1 },
      { unique: true, sparse: true },
    ),
    executionTasks.createIndex({ companyId: 1, planningId: 1 }),
    executionTasks.createIndex({ companyId: 1, assignedUserIds: 1 }),
    executionTasks.createIndex({ companyId: 1, scheduledStart: 1, scheduledEnd: 1 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureExecutionTaskIndexesPromise = null;
      throw error;
    });

  return ensureExecutionTaskIndexesPromise;
}

async function resolveCompanyWonStageKeys(db: Db, companyId: string) {
  const companyObjectId = toObjectIdOrNull(companyId);
  if (!companyObjectId) {
    return new Set<string>(["won", "gewonnen"]);
  }

  const company = await db.collection("companies").findOne(
    { _id: companyObjectId },
    { projection: { pipelineStages: 1 } },
  );

  const wonKeys = new Set<string>(["won", "gewonnen"]);
  const stages = Array.isArray((company as any)?.pipelineStages)
    ? (company as any).pipelineStages
    : [];

  for (const stage of stages) {
    const key = safeString(stage?.key).toLowerCase();
    const type = safeString(stage?.type).toLowerCase();
    if (key && type === "won") {
      wonKeys.add(key);
    }
  }

  return wonKeys;
}

export async function isPlanningWon(db: Db, planning: any) {
  const companyId =
    mongoIdToString(planning?.companyId) || safeString(planning?.companyId);
  const stageCandidates = [
    safeString(planning?.commercial?.stage).toLowerCase(),
    safeString(planning?.stage).toLowerCase(),
  ].filter(Boolean);

  if (stageCandidates.includes("won") || stageCandidates.includes("gewonnen")) {
    return true;
  }

  if (!companyId || stageCandidates.length === 0) {
    return false;
  }

  const wonKeys = await resolveCompanyWonStageKeys(db, companyId);
  return stageCandidates.some((value) => wonKeys.has(value));
}

function normalizeExecutionHistoryEntry(entry: any) {
  const stage = normalizeExecutionStage(entry?.stage) ?? "offen";
  const at =
    entry?.at instanceof Date
      ? entry.at.toISOString()
      : safeString(entry?.at) || new Date().toISOString();
  const by = safeString(entry?.by) || mongoIdToString(entry?.by) || null;

  return { stage, at, by };
}

export function normalizeExecutionTask(doc: any, opts?: {
  planningById?: Map<string, any>;
  customerById?: Map<string, any>;
  userById?: Map<string, any>;
}): NormalizedExecutionTask {
  const planningId = mongoIdToString(doc?.planningId) || safeString(doc?.planningId);
  const planning = planningId ? opts?.planningById?.get(planningId) : null;
  const customerId = mongoIdToString(doc?.customerId) || safeString(doc?.customerId) || null;
  const customer = customerId ? opts?.customerById?.get(customerId) : null;
  const assignedUserIds = Array.isArray(doc?.assignedUserIds)
    ? doc.assignedUserIds.map((value: any) => mongoIdToString(value)).filter(Boolean)
    : [];
  const assignees = assignedUserIds
    .map((id: string) => {
      const user = opts?.userById?.get(id);
      if (!user) return null;
      const firstName = safeString(user?.firstName);
      const lastName = safeString(user?.lastName);
      return {
        id,
        fullName:
          [firstName, lastName].filter(Boolean).join(" ") ||
          safeString(user?.name) ||
          safeString(user?.email),
        email: safeString(user?.email),
        executionRoles: normalizeExecutionRoles(user?.executionRoles),
      };
    })
    .filter(
      (
        value: NormalizedExecutionAssignee | null,
      ): value is NormalizedExecutionAssignee => !!value,
    );

  const planningTitle =
    safeString(doc?.planningTitle) ||
    safeString(planning?.title) ||
    safeString(planning?.summary?.customerName) ||
    safeString(planning?.planningNumber) ||
    undefined;
  const customerName =
    safeString(doc?.customerName) ||
    safeString(planning?.summary?.customerName) ||
    safeString(customer?.name) ||
    [
      safeString(customer?.firstName),
      safeString(customer?.lastName),
    ]
      .filter(Boolean)
      .join(" ") ||
    safeString(customer?.companyName) ||
    undefined;
  const projectNumber =
    safeString(doc?.projectNumber) ||
    safeString(planning?.planningNumber) ||
    undefined;

  return {
    id: mongoIdToString(doc?._id),
    companyId: mongoIdToString(doc?.companyId) || safeString(doc?.companyId),
    projectId: mongoIdToString(doc?.projectId) || safeString(doc?.projectId),
    planningId,
    customerId,
    track: normalizeExecutionTrack(doc?.track) ?? "montage",
    stage: normalizeExecutionStage(doc?.stage) ?? "offen",
    scheduledStart:
      doc?.scheduledStart instanceof Date
        ? doc.scheduledStart.toISOString()
        : safeString(doc?.scheduledStart) || null,
    scheduledEnd:
      doc?.scheduledEnd instanceof Date
        ? doc.scheduledEnd.toISOString()
        : safeString(doc?.scheduledEnd) || null,
    startTime: safeString(doc?.startTime) || null,
    endTime: safeString(doc?.endTime) || null,
    assignedUserIds,
    assignees,
    address: normalizeExecutionAddress(doc?.address),
    notes: safeString(doc?.notes),
    stageHistory: Array.isArray(doc?.stageHistory)
      ? doc.stageHistory.map(normalizeExecutionHistoryEntry)
      : [],
    ...(customerName ? { customerName } : {}),
    ...(planningTitle ? { planningTitle } : {}),
    ...(projectNumber ? { projectNumber } : {}),
    createdAt:
      doc?.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : safeString(doc?.createdAt),
    updatedAt:
      doc?.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : safeString(doc?.updatedAt),
  };
}

export async function hydrateExecutionTasks(
  db: Db,
  companyId: string,
  docs: any[],
) {
  const planningIds = Array.from<string>(
    new Set(
      docs
        .map((doc: any) => mongoIdToString(doc?.planningId) || safeString(doc?.planningId))
        .filter(Boolean),
    ),
  );
  const customerIds = Array.from<string>(
    new Set(
      docs
        .map((doc: any) => mongoIdToString(doc?.customerId) || safeString(doc?.customerId))
        .filter(Boolean),
    ),
  );
  const userIds = Array.from<string>(
    new Set(
      docs.flatMap((doc: any) =>
        Array.isArray(doc?.assignedUserIds)
          ? doc.assignedUserIds.map((value: any) => mongoIdToString(value)).filter(Boolean)
          : [],
      ),
    ),
  );

  const [planningDocs, customerDocs, userDocs] = await Promise.all([
    planningIds.length
      ? db
          .collection("plannings")
          .find(
            {
              _id: {
                $in: planningIds
                  .map((id) => toObjectIdOrNull(id))
                  .filter((value): value is ObjectId => !!value),
              },
              companyId: { $in: buildIdVariants(companyId) },
              ...activeDocumentFilter(),
            },
            { projection: { title: 1, planningNumber: 1, summary: 1 } },
          )
          .toArray()
      : Promise.resolve([]),
    customerIds.length
      ? db
          .collection("customers")
          .find(
            {
              _id: {
                $in: customerIds
                  .map((id) => toObjectIdOrNull(id))
                  .filter((value): value is ObjectId => !!value),
              },
              companyId: { $in: buildIdVariants(companyId) },
              ...activeDocumentFilter(),
            },
            { projection: { name: 1, companyName: 1, firstName: 1, lastName: 1 } },
          )
          .toArray()
      : Promise.resolve([]),
    userIds.length
      ? getCompanyMembersByIds(db, companyId, userIds)
      : Promise.resolve([]),
  ]);

  const planningById = new Map(
    planningDocs.map((doc: any) => [mongoIdToString(doc?._id), doc]),
  );
  const customerById = new Map(
    customerDocs.map((doc: any) => [mongoIdToString(doc?._id), doc]),
  );
  const userById = new Map(
    userDocs.map((doc: any) => [mongoIdToString(doc?._id), doc]),
  );

  return docs.map((doc) =>
    normalizeExecutionTask(doc, { planningById, customerById, userById }),
  );
}

export function getPlanningProjectId(planning: any) {
  return (
    mongoIdToString(planning?.projectId) ||
    safeString(planning?.projectId) ||
    safeString(planning?.data?.projectId) ||
    mongoIdToString(planning?._id)
  );
}

function buildExecutionAddress(planning: any, customer?: any) {
  return normalizeExecutionAddress(extractAddressFromPlanning(planning, customer));
}

function buildExecutionTaskSeed(params: {
  planning: any;
  track: ExecutionTrack;
  session?: SessionPayload | null;
  customer?: any;
}) {
  const now = new Date();
  const userId = getSessionUserId(params.session);

  return {
    companyId:
      mongoIdToString(params.planning?.companyId) ||
      safeString(params.planning?.companyId),
    projectId: getPlanningProjectId(params.planning),
    planningId: mongoIdToString(params.planning?._id),
    customerId:
      mongoIdToString(params.planning?.customerId) ||
      safeString(params.planning?.customerId) ||
      null,
    track: params.track,
    stage: "offen" as const,
    scheduledStart: null,
    scheduledEnd: null,
    startTime: null,
    endTime: null,
    assignedUserIds: [] as ObjectId[],
    address: buildExecutionAddress(params.planning, params.customer),
    notes: "",
    stageHistory: [
      {
        stage: "offen" as const,
        at: now.toISOString(),
        by: userId || null,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureExecutionTasksForWonPlanning(
  db: Db,
  planning: any,
  session?: SessionPayload | null,
) {
  if (!(await isPlanningWon(db, planning))) {
    return { created: 0, items: [] as any[] };
  }

  await ensureExecutionTaskIndexes(db);
  const customerId =
    mongoIdToString(planning?.customerId) || safeString(planning?.customerId);
  const customer =
    customerId && ObjectId.isValid(customerId)
      ? await db.collection("customers").findOne({
          _id: new ObjectId(customerId),
          companyId: { $in: buildIdVariants(safeString(planning?.companyId)) },
          ...activeDocumentFilter(),
        })
      : null;

  const companyId =
    mongoIdToString(planning?.companyId) || safeString(planning?.companyId);
  const projectId = getPlanningProjectId(planning);
  const planningId = mongoIdToString(planning?._id);
  const executionTasks = getExecutionTasksCollection(db);
  let created = 0;

  for (const track of EXECUTION_TRACKS) {
    const seed = buildExecutionTaskSeed({ planning, track, session, customer });
    const { planningId: seedPlanningId, customerId: seedCustomerId, address: seedAddress, updatedAt: _seedUpdatedAt, ...seedOnInsert } = seed;
    const result = await executionTasks.updateOne(
      { companyId, projectId, track },
      {
        $setOnInsert: seedOnInsert,
        $set: {
          planningId: seedPlanningId,
          customerId: seedCustomerId,
          address: seedAddress,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      created += 1;
    }
  }

  const items = await executionTasks
    .find({ companyId, projectId, track: { $in: [...EXECUTION_TRACKS] } })
    .toArray();

  return { created, items };
}

export async function backfillExecutionTasksForWonPlannings(
  db: Db,
  session?: SessionPayload | null,
) {
  await ensureExecutionTaskIndexes(db);
  const plannings = await db
    .collection("plannings")
    .find({
      ...activeDocumentFilter(),
    })
    .toArray();

  let created = 0;
  let processed = 0;
  for (const planning of plannings) {
    if (!(await isPlanningWon(db, planning))) {
      continue;
    }
    const result = await ensureExecutionTasksForWonPlanning(db, planning, session);
    created += result.created;
    processed += 1;
  }

  return { processed, created };
}

export async function migrateMontagesToExecutionTasks(
  db: Db,
  session?: SessionPayload | null,
) {
  await ensureExecutionTaskIndexes(db);
  const montages = await db.collection("montages").find({}).toArray();
  let created = 0;
  let skipped = 0;

  for (const montage of montages) {
    const companyId = mongoIdToString(montage?.companyId) || safeString(montage?.companyId);
    const projectId =
      mongoIdToString(montage?.projectId) ||
      safeString(montage?.projectId) ||
      mongoIdToString(montage?.planningId) ||
      safeString(montage?.planningId);
    const planningId =
      mongoIdToString(montage?.planningId) || safeString(montage?.planningId);

    if (!companyId || !projectId || !planningId) {
      skipped += 1;
      continue;
    }

    const stage = (() => {
      const raw = safeString(montage?.status).toLowerCase();
      if (raw === "planned" || raw === "confirmed") return "geplant";
      if (raw === "in_progress") return "in_ausfuehrung";
      if (raw === "completed") return "abgeschlossen";
      return "offen";
    })();

    const history = Array.isArray(montage?.stageHistory) && montage.stageHistory.length
      ? montage.stageHistory
      : [
          {
            stage,
            at:
              montage?.updatedAt instanceof Date
                ? montage.updatedAt.toISOString()
                : montage?.createdAt instanceof Date
                  ? montage.createdAt.toISOString()
                  : new Date().toISOString(),
            by: getSessionUserId(session) || null,
          },
        ];

    const result = await getExecutionTasksCollection(db).updateOne(
      { companyId, projectId, track: "montage" },
      {
        $setOnInsert: {
          companyId,
          projectId,
          planningId,
          customerId:
            mongoIdToString(montage?.customerId) ||
            safeString(montage?.customerId) ||
            null,
          track: "montage",
          stage,
          scheduledStart: montage?.startDate ? new Date(montage.startDate) : null,
          scheduledEnd: montage?.endDate ? new Date(montage.endDate) : null,
          startTime: safeString(montage?.startTime) || null,
          endTime: safeString(montage?.endTime) || null,
          assignedUserIds: Array.isArray(montage?.assignedInstallerIds)
            ? montage.assignedInstallerIds
                .map((value: any) => toObjectIdOrNull(value))
                .filter((value: ObjectId | null): value is ObjectId => !!value)
            : [],
          address: normalizeExecutionAddress(montage?.address),
          notes: safeString(montage?.notes),
          stageHistory: history,
          createdAt:
            montage?.createdAt instanceof Date ? montage.createdAt : new Date(),
          updatedAt:
            montage?.updatedAt instanceof Date ? montage.updatedAt : new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { processed: montages.length, created, skipped };
}

export async function validateExecutionAssignees(
  db: Db,
  companyId: string,
  track: ExecutionTrack,
  input: unknown,
) {
  const ids = Array.isArray(input)
    ? Array.from(
        new Set(
          input
            .map((value) => safeString(value))
            .filter(Boolean),
        ),
      )
    : [];

  if (!ids.length) {
    return { assignedUserIds: [] as ObjectId[], assignees: [] as any[] };
  }

  const users = await getCompanyMembersByIds(db, companyId, ids);
  if (users.length !== ids.length) {
    throw new Error("One or more assigned users are not active company members");
  }

  const invalidTrackAssignment = users.find((user: any) => {
    const roles = normalizeExecutionRoles(user?.executionRoles);
    return roles.length > 0 && !roles.includes(track);
  });
  if (invalidTrackAssignment) {
    throw new Error("One or more assigned users do not match the execution track");
  }

  return {
    assignedUserIds: ids
      .map((id) => toObjectIdOrNull(id))
      .filter((value): value is ObjectId => !!value),
    assignees: users,
  };
}

export function getExecutionTaskPermissions(session: SessionPayload | null | undefined) {
  const adminLike = isAdminLikeRole(session);
  return {
    canViewAll: adminLike,
    canEditAll: adminLike,
    canAssign: adminLike,
  };
}
