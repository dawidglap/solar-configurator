import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { buildIdVariants, getCompanyMembersByIds } from "@/lib/tasks";

export const TEAM_TRACKS = ["montage", "elektro"] as const;
export const TEAM_ROLES = ["leiter", "monteur", "elektriker", "lehrling"] as const;
export const TEAM_STATUSES = ["active", "archived"] as const;
export const TEAM_OVERRIDE_REASONS = [
  "krankheit",
  "ferien",
  "andere_baustelle",
  "sonstiges",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];
export type TeamStatus = (typeof TEAM_STATUSES)[number];
export type TeamOverrideReason = (typeof TEAM_OVERRIDE_REASONS)[number];
export type TeamTrack = (typeof TEAM_TRACKS)[number];

export class TeamRequestError extends Error {
  status: number;
  code: string;
  conflictUserIds: string[];

  constructor(
    message: string,
    options?: { status?: number; code?: string; conflictUserIds?: string[] },
  ) {
    super(message);
    this.name = "TeamRequestError";
    this.status = options?.status ?? 400;
    this.code = options?.code ?? "INVALID_TEAM";
    this.conflictUserIds = options?.conflictUserIds ?? [];
  }
}

let ensureTeamIndexesPromise: Promise<void> | null = null;

export function getTeamsCollection(db: Db) {
  return db.collection("teams");
}

export async function ensureTeamIndexes(db: Db) {
  if (ensureTeamIndexesPromise) return ensureTeamIndexesPromise;

  const teams = getTeamsCollection(db);
  ensureTeamIndexesPromise = Promise.all([
    teams.createIndex({ companyId: 1, status: 1 }),
    teams.createIndex(
      { companyId: 1, "members.userId": 1 },
      {
        unique: true,
        partialFilterExpression: { status: "active" },
        name: "unique_active_team_member_per_company",
      },
    ),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureTeamIndexesPromise = null;
      throw error;
    });

  return ensureTeamIndexesPromise;
}

export function normalizeTeamStatus(value: unknown): TeamStatus | null {
  const normalized = safeString(value).toLowerCase() as TeamStatus;
  return TEAM_STATUSES.includes(normalized) ? normalized : null;
}

export function normalizeTeamTracks(input: unknown): TeamTrack[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => safeString(value).toLowerCase())
        .filter((value): value is TeamTrack => TEAM_TRACKS.includes(value as TeamTrack)),
    ),
  );
}

export function normalizeTeamMembers(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ userId: ObjectId; role: TeamRole }>;

  const seen = new Set<string>();
  return input.map((member: any) => {
    const userId = toObjectIdOrNull(member?.userId);
    const role = safeString(member?.role).toLowerCase() as TeamRole;
    if (!userId) {
      throw new TeamRequestError("Ungültige Mitarbeiter-ID.", { code: "INVALID_USER_ID" });
    }
    if (!TEAM_ROLES.includes(role)) {
      throw new TeamRequestError("Ungültige Teamrolle.", { code: "INVALID_TEAM_ROLE" });
    }
    const key = userId.toString();
    if (seen.has(key)) {
      throw new TeamRequestError("Ein Mitarbeiter darf im Team nur einmal vorkommen.", {
        code: "DUPLICATE_TEAM_MEMBER",
      });
    }
    seen.add(key);
    return { userId, role };
  });
}

function normalizeUserName(user: any) {
  return (
    [safeString(user?.firstName), safeString(user?.lastName)].filter(Boolean).join(" ") ||
    safeString(user?.name) ||
    safeString(user?.email)
  );
}

export async function hydrateTeams(db: Db, docs: any[]) {
  const userIds = Array.from(
    new Set(
      docs.flatMap((doc) =>
        Array.isArray(doc?.members)
          ? doc.members
              .map((member: any) => mongoIdToString(member?.userId))
              .filter(Boolean)
          : [],
      ),
    ),
  );
  const users = userIds.length
    ? await db
        .collection("users")
        .find(
          {
            _id: {
              $in: userIds
                .map((userId) => toObjectIdOrNull(userId))
                .filter((value): value is ObjectId => !!value),
            },
          },
          { projection: { firstName: 1, lastName: 1, name: 1, email: 1 } },
        )
        .toArray()
    : [];
  const usersById = new Map(users.map((user) => [mongoIdToString(user._id), user]));

  return docs.map((doc) => ({
    id: mongoIdToString(doc?._id),
    companyId: mongoIdToString(doc?.companyId) || safeString(doc?.companyId),
    name: safeString(doc?.name),
    color: safeString(doc?.color),
    tracks: normalizeTeamTracks(doc?.tracks),
    members: Array.isArray(doc?.members)
      ? doc.members.map((member: any) => {
          const userId = mongoIdToString(member?.userId);
          const user = usersById.get(userId);
          return {
            userId,
            role: safeString(member?.role),
            fullName: user ? normalizeUserName(user) : "",
            email: user ? safeString(user?.email) : "",
          };
        })
      : [],
    status: normalizeTeamStatus(doc?.status) ?? "active",
    createdAt:
      doc?.createdAt instanceof Date ? doc.createdAt.toISOString() : safeString(doc?.createdAt),
    updatedAt:
      doc?.updatedAt instanceof Date ? doc.updatedAt.toISOString() : safeString(doc?.updatedAt),
  }));
}

export async function findActiveTeamMemberConflicts(
  db: Db,
  companyId: string,
  userIds: string[],
  excludeTeamId?: string,
) {
  const objectIds = userIds
    .map((userId) => toObjectIdOrNull(userId))
    .filter((value): value is ObjectId => !!value);
  if (!objectIds.length) return [];

  const filter: Record<string, any> = {
    companyId: { $in: buildIdVariants(companyId) },
    status: "active",
    "members.userId": { $in: objectIds },
  };
  const excludedObjectId = toObjectIdOrNull(excludeTeamId);
  if (excludedObjectId) filter._id = { $ne: excludedObjectId };

  const conflictingTeams = await getTeamsCollection(db)
    .find(filter, { projection: { members: 1 } })
    .toArray();
  const requested = new Set(userIds);
  return Array.from(
    new Set(
      conflictingTeams.flatMap((team) =>
        Array.isArray(team?.members)
          ? team.members
              .map((member: any) => mongoIdToString(member?.userId))
              .filter((userId: string) => requested.has(userId))
          : [],
      ),
    ),
  );
}

export async function validateTeamMembers(
  db: Db,
  companyId: string,
  members: Array<{ userId: ObjectId; role: TeamRole }>,
  options?: { excludeTeamId?: string; checkConflicts?: boolean },
) {
  if (!members.length) {
    throw new TeamRequestError("Ein Team benötigt mindestens ein Mitglied.", {
      code: "TEAM_MEMBERS_REQUIRED",
    });
  }
  const ids = members.map((member) => member.userId.toString());
  const users = await getCompanyMembersByIds(db, companyId, ids);
  if (users.length !== ids.length) {
    throw new TeamRequestError("Mindestens ein Mitarbeiter ist kein aktives Firmenmitglied.", {
      code: "INVALID_TEAM_MEMBER",
    });
  }

  if (options?.checkConflicts !== false) {
    const conflictUserIds = await findActiveTeamMemberConflicts(
      db,
      companyId,
      ids,
      options?.excludeTeamId,
    );
    if (conflictUserIds.length) {
      throw new TeamRequestError("Mindestens ein Mitarbeiter gehört bereits zu einem aktiven Team.", {
        status: 409,
        code: "USER_ALREADY_IN_TEAM",
        conflictUserIds,
      });
    }
  }

  return members;
}

export function normalizeStoredTeamOverrides(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.map((override: any) => ({
    outUserId: mongoIdToString(override?.outUserId) || safeString(override?.outUserId),
    inUserId:
      mongoIdToString(override?.inUserId) || safeString(override?.inUserId) || null,
    reason: safeString(override?.reason) as TeamOverrideReason,
    note: safeString(override?.note),
    createdAt:
      override?.createdAt instanceof Date && !Number.isNaN(override.createdAt.getTime())
        ? override.createdAt.toISOString()
        : safeString(override?.createdAt),
    createdByUserId:
      mongoIdToString(override?.createdByUserId) ||
      safeString(override?.createdByUserId) ||
      null,
  }));
}

function overrideIdentity(override: any) {
  return JSON.stringify({
    outUserId: mongoIdToString(override?.outUserId) || safeString(override?.outUserId),
    inUserId:
      mongoIdToString(override?.inUserId) || safeString(override?.inUserId) || null,
    reason: safeString(override?.reason),
    note: safeString(override?.note),
    createdAt:
      override?.createdAt instanceof Date && !Number.isNaN(override.createdAt.getTime())
        ? override.createdAt.toISOString()
        : safeString(override?.createdAt),
  });
}

export async function normalizeAndValidateTeamOverrides(params: {
  db: Db;
  companyId: string;
  input: unknown;
  teamMemberIds: string[];
  existing?: unknown;
  actorUserId: string | null;
}) {
  if (!Array.isArray(params.input)) {
    throw new TeamRequestError("teamOverrides muss ein Array sein.", {
      code: "INVALID_TEAM_OVERRIDES",
    });
  }

  const existing = Array.isArray(params.existing) ? params.existing : [];
  const existingByIdentity = new Map(existing.map((item) => [overrideIdentity(item), item]));
  const teamMembers = new Set(params.teamMemberIds);
  const now = new Date();
  const actorObjectId = toObjectIdOrNull(params.actorUserId);
  const normalized = params.input.map((override: any) => {
    const outUserId = toObjectIdOrNull(override?.outUserId);
    const rawInUserId = override?.inUserId;
    const inUserId = rawInUserId == null || rawInUserId === "" ? null : toObjectIdOrNull(rawInUserId);
    const reason = safeString(override?.reason).toLowerCase() as TeamOverrideReason;
    if (!outUserId || !teamMembers.has(outUserId.toString())) {
      throw new TeamRequestError("Das zu ersetzende Teammitglied gehört nicht zum gewählten Team.", {
        code: "OUT_USER_NOT_IN_TEAM",
      });
    }
    if (rawInUserId != null && rawInUserId !== "" && !inUserId) {
      throw new TeamRequestError("Ungültige Ersatz-Mitarbeiter-ID.", {
        code: "INVALID_REPLACEMENT_USER",
      });
    }
    if (!TEAM_OVERRIDE_REASONS.includes(reason)) {
      throw new TeamRequestError("Ungültiger Grund für den Team-Override.", {
        code: "INVALID_OVERRIDE_REASON",
      });
    }
    if (inUserId?.equals(outUserId)) {
      throw new TeamRequestError("Ersatz und ersetztes Mitglied dürfen nicht identisch sein.", {
        code: "INVALID_REPLACEMENT_USER",
      });
    }

    const suppliedCreatedAt =
      override?.createdAt instanceof Date
        ? override.createdAt
        : safeString(override?.createdAt)
          ? new Date(safeString(override?.createdAt))
          : null;
    const candidate = {
      outUserId,
      inUserId,
      reason,
      note: safeString(override?.note).slice(0, 1000),
      createdAt:
        suppliedCreatedAt && !Number.isNaN(suppliedCreatedAt.getTime())
          ? suppliedCreatedAt
          : now,
      createdByUserId:
        toObjectIdOrNull(override?.createdByUserId) || actorObjectId || params.actorUserId || null,
    };
    const preserved = existingByIdentity.get(overrideIdentity(candidate));
    return preserved || candidate;
  });

  const replacementIds = Array.from(
    new Set(
      normalized
        .map((override: any) => mongoIdToString(override?.inUserId))
        .filter(Boolean),
    ),
  );
  if (replacementIds.length) {
    const users = await getCompanyMembersByIds(params.db, params.companyId, replacementIds);
    if (users.length !== replacementIds.length) {
      throw new TeamRequestError("Mindestens ein Ersatz ist kein aktives Firmenmitglied.", {
        code: "INVALID_REPLACEMENT_USER",
      });
    }
  }
  return normalized;
}

export function deriveAssignedUserIds(teamMemberIds: string[], overrides: unknown) {
  const effective = new Set(teamMemberIds);
  const latestByOutUserId = new Map<string, any>();
  if (Array.isArray(overrides)) {
    for (const override of overrides) {
      const outUserId = mongoIdToString(override?.outUserId) || safeString(override?.outUserId);
      if (outUserId) latestByOutUserId.set(outUserId, override);
    }
  }
  for (const [outUserId, override] of latestByOutUserId) {
    effective.delete(outUserId);
    const inUserId = mongoIdToString(override?.inUserId) || safeString(override?.inUserId);
    if (inUserId) effective.add(inUserId);
  }
  return Array.from(effective);
}

function dateOnlyKey(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function timeToMinutes(value: unknown) {
  const normalized = safeString(value);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

export function hasAvailabilityOverlap(
  requested: { start: Date; end: Date; startTime?: string | null; endTime?: string | null },
  task: {
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    startTime?: string | null;
    endTime?: string | null;
  },
) {
  const taskStart = task.scheduledStart ? new Date(task.scheduledStart) : null;
  if (!taskStart || Number.isNaN(taskStart.getTime())) return false;
  const taskEnd = task.scheduledEnd ? new Date(task.scheduledEnd) : taskStart;
  if (Number.isNaN(taskEnd.getTime())) return false;

  const requestedStartDay = dateOnlyKey(requested.start);
  const requestedEndDay = dateOnlyKey(requested.end);
  const taskStartDay = dateOnlyKey(taskStart);
  const taskEndDay = dateOnlyKey(taskEnd);
  if (requestedStartDay > taskEndDay || taskStartDay > requestedEndDay) return false;

  const bothSingleDay =
    requestedStartDay === requestedEndDay && taskStartDay === taskEndDay;
  if (!bothSingleDay) return true;

  const requestedStartTime = timeToMinutes(requested.startTime);
  const requestedEndTime = timeToMinutes(requested.endTime);
  const taskStartTime = timeToMinutes(task.startTime);
  const taskEndTime = timeToMinutes(task.endTime);
  if (
    requestedStartTime == null ||
    requestedEndTime == null ||
    taskStartTime == null ||
    taskEndTime == null
  ) {
    return true;
  }
  return requestedStartTime < taskEndTime && taskStartTime < requestedEndTime;
}

export function parseAvailabilityDate(value: unknown, endOfDay = false) {
  const normalized = safeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  return date;
}
