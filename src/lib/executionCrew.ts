import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { buildIdVariants, getCompanyMembersByIds } from "@/lib/tasks";
import { deriveAssignedUserIds, getTeamsCollection, TEAM_ROLES, type TeamRole } from "@/lib/teams";

export type ExtraAssignment = {
  userId: string;
  role: TeamRole;
  sourceTeamId: string | null;
  days: string[] | null;
  startTime: string | null;
  endTime: string | null;
  note: string;
};

export type ExecutionCrewConflict = {
  userId: string;
  conflictingTaskId: string;
  projectName: string;
  days: string[];
  startTime: string | null;
  endTime: string | null;
};

export class ExecutionCrewRequestError extends Error {
  status = 400;
  code: string;

  constructor(message: string, code = "INVALID_EXECUTION_CREW") {
    super(message);
    this.name = "ExecutionCrewRequestError";
    this.code = code;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function dateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = safeString(value);
  if (!raw) return null;
  const parsedRaw = new Date(raw);
  if (!DATE_ONLY_RE.test(raw) && Number.isNaN(parsedRaw.getTime())) return null;
  const candidate = DATE_ONLY_RE.test(raw) ? raw : parsedRaw.toISOString().slice(0, 10);
  if (!DATE_ONLY_RE.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function validDateOnly(value: unknown) {
  const raw = safeString(value);
  if (!DATE_ONLY_RE.test(raw)) return null;
  return dateOnly(raw);
}

function enumerateDays(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function normalizeId(value: unknown) {
  return mongoIdToString(value) || safeString(value);
}

export function normalizeStoredAdditionalTeamIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map(normalizeId).filter(Boolean)));
}

export function normalizeStoredExtraAssignments(input: unknown): ExtraAssignment[] {
  if (!Array.isArray(input)) return [];
  return input.map((assignment: any) => ({
    userId: normalizeId(assignment?.userId),
    role: safeString(assignment?.role).toLowerCase() as TeamRole,
    sourceTeamId: normalizeId(assignment?.sourceTeamId) || null,
    days: Array.isArray(assignment?.days)
      ? assignment.days.map((day: unknown) => safeString(day)).filter(Boolean)
      : null,
    startTime: safeString(assignment?.startTime) || null,
    endTime: safeString(assignment?.endTime) || null,
    note: safeString(assignment?.note),
  }));
}

function normalizeTeamIdArray(input: unknown, mainTeamId: string | null) {
  if (!Array.isArray(input)) {
    throw new ExecutionCrewRequestError("additionalTeamIds muss ein Array sein.", "INVALID_ADDITIONAL_TEAM_IDS");
  }
  const seen = new Set<string>();
  return input.map((value) => {
    const id = toObjectIdOrNull(value);
    if (!id) {
      throw new ExecutionCrewRequestError("Eine Zusatzteam-ID ist ungültig.", "INVALID_ADDITIONAL_TEAM_ID");
    }
    const key = id.toString();
    if (key === mainTeamId) {
      throw new ExecutionCrewRequestError("Das Haupt-Team darf nicht nochmals als Zusatzteam gesetzt werden.", "DUPLICATE_MAIN_TEAM");
    }
    if (seen.has(key)) {
      throw new ExecutionCrewRequestError("Ein Zusatzteam darf nur einmal vorkommen.", "DUPLICATE_ADDITIONAL_TEAM");
    }
    seen.add(key);
    return id;
  });
}

function normalizeAssignmentTimePair(assignment: any) {
  const startTime = assignment?.startTime == null || assignment?.startTime === ""
    ? null
    : safeString(assignment.startTime);
  const endTime = assignment?.endTime == null || assignment?.endTime === ""
    ? null
    : safeString(assignment.endTime);
  if ((startTime == null) !== (endTime == null)) {
    throw new ExecutionCrewRequestError(
      "Bei einer Zusatzkraft müssen startTime und endTime gemeinsam gesetzt werden.",
      "INCOMPLETE_EXTRA_ASSIGNMENT_TIME",
    );
  }
  if (startTime && (!TIME_RE.test(startTime) || !TIME_RE.test(endTime!))) {
    throw new ExecutionCrewRequestError("Zeitfenster müssen das Format HH:mm haben.", "INVALID_EXTRA_ASSIGNMENT_TIME");
  }
  if (startTime && endTime && startTime >= endTime) {
    throw new ExecutionCrewRequestError("endTime muss nach startTime liegen.", "INVALID_EXTRA_ASSIGNMENT_TIME_RANGE");
  }
  return { startTime, endTime };
}

export async function normalizeAndValidateAdditionalCrew(args: {
  db: Db;
  companyId: string;
  mainTeamId: string | null;
  additionalTeamIds: unknown;
  extraAssignments: unknown;
  scheduledStart: unknown;
  scheduledEnd: unknown;
}) {
  const additionalTeamIds = normalizeTeamIdArray(args.additionalTeamIds, args.mainTeamId);
  if (!Array.isArray(args.extraAssignments)) {
    throw new ExecutionCrewRequestError("extraAssignments muss ein Array sein.", "INVALID_EXTRA_ASSIGNMENTS");
  }

  const taskStart = dateOnly(args.scheduledStart);
  const taskEnd = dateOnly(args.scheduledEnd) || taskStart;
  if (taskStart && taskEnd && taskStart > taskEnd) {
    throw new ExecutionCrewRequestError("scheduledEnd darf nicht vor scheduledStart liegen.", "INVALID_SCHEDULE_RANGE");
  }

  const seenUsers = new Set<string>();
  const extraAssignments = args.extraAssignments.map((assignment: any) => {
    const userId = toObjectIdOrNull(assignment?.userId);
    if (!userId) {
      throw new ExecutionCrewRequestError("Eine Zusatzkraft-ID ist ungültig.", "INVALID_EXTRA_ASSIGNMENT_USER");
    }
    const userKey = userId.toString();
    if (seenUsers.has(userKey)) {
      throw new ExecutionCrewRequestError(
        "Eine Zusatzkraft darf pro Auftrag nur einmal vorkommen.",
        "DUPLICATE_EXTRA_ASSIGNMENT_USER",
      );
    }
    seenUsers.add(userKey);

    const role = safeString(assignment?.role).toLowerCase() as TeamRole;
    if (!TEAM_ROLES.includes(role)) {
      throw new ExecutionCrewRequestError("Die Rolle einer Zusatzkraft ist ungültig.", "INVALID_EXTRA_ASSIGNMENT_ROLE");
    }
    const sourceTeamId = assignment?.sourceTeamId == null || assignment?.sourceTeamId === ""
      ? null
      : toObjectIdOrNull(assignment.sourceTeamId);
    if (assignment?.sourceTeamId != null && assignment?.sourceTeamId !== "" && !sourceTeamId) {
      throw new ExecutionCrewRequestError("sourceTeamId ist ungültig.", "INVALID_SOURCE_TEAM_ID");
    }
    if (sourceTeamId && !additionalTeamIds.some((id) => id.equals(sourceTeamId))) {
      throw new ExecutionCrewRequestError(
        "sourceTeamId muss in additionalTeamIds enthalten sein.",
        "SOURCE_TEAM_NOT_ADDITIONAL",
      );
    }

    let days: string[] | null = null;
    if (assignment?.days !== null && assignment?.days !== undefined) {
      if (!Array.isArray(assignment.days) || assignment.days.length === 0) {
        throw new ExecutionCrewRequestError("days muss null oder eine nicht leere Liste sein.", "INVALID_EXTRA_ASSIGNMENT_DAYS");
      }
      days = [];
      const seenDays = new Set<string>();
      for (const value of assignment.days) {
        const day = validDateOnly(value);
        if (!day) {
          throw new ExecutionCrewRequestError("Zusatzkraft-Tage müssen gültige ISO-Daten (yyyy-mm-dd) sein.", "INVALID_EXTRA_ASSIGNMENT_DAY");
        }
        if (!taskStart || !taskEnd || day < taskStart || day > taskEnd) {
          throw new ExecutionCrewRequestError("Ein Zusatzkraft-Tag liegt ausserhalb des Termin-Zeitraums.", "EXTRA_ASSIGNMENT_DAY_OUTSIDE_SCHEDULE");
        }
        if (!seenDays.has(day)) {
          seenDays.add(day);
          days.push(day);
        }
      }
    }
    const { startTime, endTime } = normalizeAssignmentTimePair(assignment);
    const note = safeString(assignment?.note);
    if (note.length > 1000) {
      throw new ExecutionCrewRequestError("Die Notiz einer Zusatzkraft darf höchstens 1000 Zeichen lang sein.", "EXTRA_ASSIGNMENT_NOTE_TOO_LONG");
    }
    return { userId, role, sourceTeamId, days, startTime, endTime, note };
  });

  const teamIds = Array.from(new Set([
    ...additionalTeamIds.map((id) => id.toString()),
    ...extraAssignments.map((item) => item.sourceTeamId?.toString()).filter(Boolean) as string[],
  ]));
  const teams = teamIds.length
    ? await getTeamsCollection(args.db).find({
        _id: { $in: teamIds.map((id) => new ObjectId(id)) },
        companyId: { $in: buildIdVariants(args.companyId) },
      }).toArray()
    : [];
  if (teams.length !== teamIds.length) {
    throw new ExecutionCrewRequestError("Mindestens ein Zusatzteam gehört nicht zur Firma oder existiert nicht.", "INVALID_ADDITIONAL_TEAM");
  }
  const teamById = new Map(teams.map((team: any) => [team._id.toString(), team]));
  for (const assignment of extraAssignments) {
    if (!assignment.sourceTeamId) continue;
    const sourceTeam = teamById.get(assignment.sourceTeamId.toString());
    const isSourceMember = Array.isArray(sourceTeam?.members) && sourceTeam.members.some(
      (member: any) => normalizeId(member?.userId) === assignment.userId.toString(),
    );
    if (!isSourceMember) {
      throw new ExecutionCrewRequestError(
        "Die Zusatzkraft ist kein Mitglied des angegebenen sourceTeamId.",
        "EXTRA_ASSIGNMENT_USER_NOT_IN_SOURCE_TEAM",
      );
    }
  }

  const userIds = extraAssignments.map((item) => item.userId.toString());
  const users = userIds.length ? await getCompanyMembersByIds(args.db, args.companyId, userIds) : [];
  if (users.length !== userIds.length) {
    throw new ExecutionCrewRequestError("Mindestens eine Zusatzkraft ist kein aktives Firmenmitglied.", "INVALID_EXTRA_ASSIGNMENT_USER");
  }

  const additionalTeamMemberIds = Array.from(new Set(teams.flatMap((team: any) =>
    Array.isArray(team?.members) ? team.members.map((member: any) => normalizeId(member?.userId)).filter(Boolean) : [],
  )));
  return {
    additionalTeamIds: additionalTeamIds.map((id) => id.toString()),
    extraAssignments: extraAssignments.map((assignment) => ({
      userId: assignment.userId.toString(),
      role: assignment.role,
      sourceTeamId: assignment.sourceTeamId?.toString() || null,
      days: assignment.days,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      note: assignment.note,
    })),
    teams,
    users,
    additionalTeamMemberIds,
  };
}

export function deriveExecutionCrewUserIds(args: {
  mainTeamMemberIds: string[];
  teamOverrides: unknown;
  additionalTeamMemberIds: string[];
  extraAssignments: unknown;
}) {
  return Array.from(new Set([
    ...deriveAssignedUserIds(args.mainTeamMemberIds, args.teamOverrides),
    ...args.additionalTeamMemberIds,
    ...normalizeStoredExtraAssignments(args.extraAssignments).map((assignment) => assignment.userId),
  ].filter(Boolean)));
}

export function getExecutionUserBooking(task: any, userId: string) {
  const assignment = normalizeStoredExtraAssignments(task?.extraAssignments)
    .find((item) => item.userId === userId);
  const start = dateOnly(task?.scheduledStart);
  const end = dateOnly(task?.scheduledEnd) || start;
  if (!start || !end || start > end) return null;
  return {
    days: assignment?.days ?? enumerateDays(start, end),
    startTime: assignment ? assignment.startTime : safeString(task?.startTime) || null,
    endTime: assignment ? assignment.endTime : safeString(task?.endTime) || null,
  };
}

function timeMinutes(value: string | null) {
  if (!value || !TIME_RE.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getExecutionBookingOverlap(
  left: ReturnType<typeof getExecutionUserBooking>,
  right: ReturnType<typeof getExecutionUserBooking>,
) {
  if (!left || !right) return [];
  const rightDays = new Set(right.days);
  const overlappingDays = left.days.filter((day) => rightDays.has(day));
  if (!overlappingDays.length) return [];
  const leftStart = timeMinutes(left.startTime);
  const leftEnd = timeMinutes(left.endTime);
  const rightStart = timeMinutes(right.startTime);
  const rightEnd = timeMinutes(right.endTime);
  if (leftStart == null || leftEnd == null || rightStart == null || rightEnd == null) return overlappingDays;
  return leftStart < rightEnd && rightStart < leftEnd ? overlappingDays : [];
}

export async function findExecutionCrewConflicts(args: {
  db: Db;
  companyId: string;
  task: any;
}) {
  const userIds = Array.from<string>(new Set<string>(
    Array.isArray(args.task?.assignedUserIds)
      ? args.task.assignedUserIds.map(normalizeId).filter(Boolean)
      : [],
  ));
  if (!userIds.length) return [] as ExecutionCrewConflict[];
  const taskId = normalizeId(args.task?._id);
  const bookings = new Map(userIds.map((userId) => [userId, getExecutionUserBooking(args.task, userId)]));
  const allDays = Array.from(new Set(Array.from(bookings.values()).flatMap((booking) => booking?.days ?? []))).sort();
  if (!allDays.length) return [] as ExecutionCrewConflict[];

  const taskObjectId = toObjectIdOrNull(taskId);
  const candidateFilter: Record<string, any> = {
    companyId: { $in: buildIdVariants(args.companyId) },
    ...(taskObjectId ? { _id: { $ne: taskObjectId } } : {}),
    assignedUserIds: { $in: userIds.flatMap(buildIdVariants) },
    scheduledStart: { $ne: null, $lte: new Date(`${allDays.at(-1)}T23:59:59.999Z`) },
    $or: [
      { scheduledEnd: { $gte: new Date(`${allDays[0]}T00:00:00.000Z`) } },
      { scheduledEnd: null, scheduledStart: { $gte: new Date(`${allDays[0]}T00:00:00.000Z`) } },
      { scheduledEnd: { $exists: false }, scheduledStart: { $gte: new Date(`${allDays[0]}T00:00:00.000Z`) } },
    ],
  };
  const candidates = await args.db.collection("executionTasks").find(candidateFilter).toArray();

  const planningIds = Array.from(new Set(candidates.map((task) => normalizeId(task?.planningId)).filter(Boolean)));
  const plannings = planningIds.length
    ? await args.db.collection("plannings").find({
        _id: { $in: planningIds.map(toObjectIdOrNull).filter((id): id is ObjectId => !!id) },
        companyId: { $in: buildIdVariants(args.companyId) },
      }, { projection: { title: 1, planningNumber: 1, summary: 1 } }).toArray()
    : [];
  const planningById = new Map(plannings.map((planning) => [normalizeId(planning?._id), planning]));
  const conflicts: ExecutionCrewConflict[] = [];
  for (const candidate of candidates) {
    const candidateUsers = new Set<string>(
      Array.isArray(candidate?.assignedUserIds) ? candidate.assignedUserIds.map(normalizeId).filter(Boolean) : [],
    );
    for (const userId of userIds) {
      if (!candidateUsers.has(userId)) continue;
      const candidateBooking = getExecutionUserBooking(candidate, userId);
      const days = getExecutionBookingOverlap(bookings.get(userId) ?? null, candidateBooking);
      if (!days.length) continue;
      const planning = planningById.get(normalizeId(candidate?.planningId));
      conflicts.push({
        userId,
        conflictingTaskId: normalizeId(candidate?._id),
        projectName:
          safeString(candidate?.planningTitle) ||
          safeString(planning?.title) ||
          safeString(planning?.summary?.customerName) ||
          safeString(planning?.planningNumber) ||
          safeString(candidate?.projectNumber) ||
          "Unbekanntes Projekt",
        days,
        startTime: candidateBooking?.startTime ?? null,
        endTime: candidateBooking?.endTime ?? null,
      });
    }
  }
  return conflicts;
}
