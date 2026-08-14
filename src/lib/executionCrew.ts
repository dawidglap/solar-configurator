import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { buildIdVariants, getCompanyMembersByIds } from "@/lib/tasks";
import { deriveAssignedUserIds, getTeamsCollection, TEAM_ROLES, type TeamRole } from "@/lib/teams";
import {
  buildAbsenceOverlapFilter,
  ensureAbsenceIndexes,
  getAbsenceBooking,
  getAbsencesCollection,
  syncCrewDeviationAbsences,
} from "@/lib/absences";
import {
  deriveExecutionWorkingDays,
  getExecutionWorkingDays,
} from "@/lib/executionWorkingDays";

export type ExtraAssignment = {
  userId: string;
  role: TeamRole;
  sourceTeamId: string | null;
  days: string[] | null;
  startTime: string | null;
  endTime: string | null;
  dayWindows: ExtraAssignmentDayWindow[] | null;
  note: string;
  replacementForDeviationIds?: string[];
};

export type ExtraAssignmentDayWindow = {
  day: string;
  startTime: string | null;
  endTime: string | null;
};

export const CREW_DEVIATION_TYPES = [
  "krank",
  "unfall",
  "ferien",
  "arzttermin",
  "weiterbildung",
  "verspaetet",
  "frueher_weg",
  "teilweise_abwesend",
  "sonstiges",
] as const;

export type CrewDeviationType = (typeof CREW_DEVIATION_TYPES)[number];

export const GLOBAL_CREW_DEVIATION_TYPES = new Set<CrewDeviationType>([
  "krank",
  "unfall",
  "ferien",
  "weiterbildung",
  "arzttermin",
]);

export type CrewDeviation = {
  id: string;
  userId: string;
  type: CrewDeviationType;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  global: boolean;
  note: string;
  replacementUserId: string | null;
  actorName: string;
  at: string;
};

export type ExecutionBooking = {
  days: string[];
  startTime: string | null;
  endTime: string | null;
  dayWindows?: ExtraAssignmentDayWindow[] | null;
  unavailableWindows?: ExtraAssignmentDayWindow[];
};

export type ExecutionCrewConflict = {
  type: "task";
  userId: string;
  conflictingTaskId: string;
  projectName: string;
  day: string;
  days: string[];
  startTime: string | null;
  endTime: string | null;
} | {
  type: "absence";
  userId: string;
  absenceId: string;
  reason: string;
  startDate: string;
  endDate: string;
  day: string;
  days: string[];
  startTime: string | null;
  endTime: string | null;
};

export class ExecutionCrewRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_EXECUTION_CREW", status = 400) {
    super(message);
    this.name = "ExecutionCrewRequestError";
    this.code = code;
    this.status = status;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function dateOnly(value: unknown) {
  const localDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDate(value);
  const raw = safeString(value);
  if (!raw) return null;
  const parsedRaw = new Date(raw);
  if (!DATE_ONLY_RE.test(raw) && Number.isNaN(parsedRaw.getTime())) return null;
  const candidate = DATE_ONLY_RE.test(raw) ? raw : localDate(parsedRaw);
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
    dayWindows: Array.isArray(assignment?.dayWindows)
      ? assignment.dayWindows.map((window: any) => ({
          day: safeString(window?.day),
          startTime: safeString(window?.startTime) || null,
          endTime: safeString(window?.endTime) || null,
        }))
      : null,
    note: safeString(assignment?.note),
    ...(Array.isArray(assignment?.replacementForDeviationIds)
      ? {
          replacementForDeviationIds: Array.from(new Set(
            assignment.replacementForDeviationIds.map((value: unknown) => safeString(value)).filter(Boolean),
          )),
        }
      : {}),
  }));
}

export function applyCrewDeviationReplacements(
  input: unknown,
  deviations: CrewDeviation[],
  defaultRole: TeamRole,
  previousAutoReplacementUserIds: string[] = [],
  schedule?: {
    scheduledStart: unknown;
    scheduledEnd: unknown;
    taskStartTime?: unknown;
    taskEndTime?: unknown;
    sourceAssignments?: unknown;
  },
) {
  const previousAutoUsers = new Set(previousAutoReplacementUserIds);
  const manualAssignments = (Array.isArray(input) ? input : []).filter(
    (assignment: any) =>
      !Array.isArray(assignment?.replacementForDeviationIds) &&
      !previousAutoUsers.has(normalizeId(assignment?.userId)),
  );
  const byReplacement = new Map<string, CrewDeviation[]>();
  for (const deviation of deviations) {
    if (!deviation.replacementUserId) continue;
    const values = byReplacement.get(deviation.replacementUserId) ?? [];
    values.push(deviation);
    byReplacement.set(deviation.replacementUserId, values);
  }

  function replacementSchedule(replacementDeviations: CrewDeviation[]) {
    const byDay = new Map<string, Array<{ startTime: string | null; endTime: string | null }>>();
    for (const deviation of replacementDeviations) {
      for (const day of deviation.days) {
        const windows = byDay.get(day) ?? [];
        const plannedWindow = schedule
          ? getPlannedExecutionWindow({
              userId: deviation.userId,
              day,
              extraAssignments: schedule.sourceAssignments,
              scheduledStart: schedule.scheduledStart,
              scheduledEnd: schedule.scheduledEnd,
              taskStartTime: schedule.taskStartTime,
              taskEndTime: schedule.taskEndTime,
            })
          : null;
        windows.push({
          startTime: deviation.startTime ?? plannedWindow?.startTime ?? null,
          endTime: deviation.endTime ?? plannedWindow?.endTime ?? null,
        });
        byDay.set(day, windows);
      }
    }
    const dayWindows = Array.from(byDay, ([day, windows]) => {
      if (windows.some((window) => !window.startTime || !window.endTime)) {
        return { day, startTime: null, endTime: null };
      }
      return {
        day,
        startTime: windows.map((window) => window.startTime!).sort()[0],
        endTime: windows.map((window) => window.endTime!).sort().at(-1)!,
      };
    }).sort((left, right) => left.day.localeCompare(right.day));
    const firstWindow = dayWindows[0];
    const sameWindow = dayWindows.every(
      (window) => window.startTime === firstWindow?.startTime && window.endTime === firstWindow?.endTime,
    );
    return {
      days: dayWindows.map((window) => window.day),
      startTime: sameWindow ? firstWindow?.startTime ?? null : null,
      endTime: sameWindow ? firstWindow?.endTime ?? null : null,
      dayWindows,
    };
  }

  const scheduledManualAssignments = manualAssignments.map((assignment: any) => {
    const userId = normalizeId(assignment?.userId);
    const replacementDeviations = byReplacement.get(userId);
    if (!replacementDeviations) return assignment;
    byReplacement.delete(userId);
    if (assignment?.days == null) return assignment;
    const replacement = replacementSchedule(replacementDeviations);
    const mergedByDay = new Map<string, ExtraAssignmentDayWindow>();
    for (const day of Array.isArray(assignment?.days) ? assignment.days : []) {
      const existingWindow = Array.isArray(assignment?.dayWindows)
        ? assignment.dayWindows.find((window: any) => safeString(window?.day) === safeString(day))
        : null;
      mergedByDay.set(safeString(day), {
        day: safeString(day),
        startTime: safeString(existingWindow?.startTime ?? assignment?.startTime) || null,
        endTime: safeString(existingWindow?.endTime ?? assignment?.endTime) || null,
      });
    }
    for (const window of replacement.dayWindows) mergedByDay.set(window.day, window);
    const dayWindows = Array.from(mergedByDay.values()).sort((left, right) =>
      left.day.localeCompare(right.day),
    );
    const firstWindow = dayWindows[0];
    const sameWindow = dayWindows.every(
      (window) => window.startTime === firstWindow?.startTime && window.endTime === firstWindow?.endTime,
    );
    return {
      ...assignment,
      days: dayWindows.map((window) => window.day),
      startTime: sameWindow ? firstWindow?.startTime ?? null : null,
      endTime: sameWindow ? firstWindow?.endTime ?? null : null,
      dayWindows,
    };
  });
  const generated = Array.from(byReplacement, ([userId, replacementDeviations]) => {
    return {
      userId,
      role: defaultRole,
      sourceTeamId: null,
      ...replacementSchedule(replacementDeviations),
      note: "",
      replacementForDeviationIds: replacementDeviations.map((deviation) => deviation.id).sort(),
    };
  });
  return [...scheduledManualAssignments, ...generated];
}

export function normalizeStoredCrewDeviations(input: unknown): CrewDeviation[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((deviation: any) => {
    const sourceDays = Array.isArray(deviation?.days)
      ? deviation.days.map((day: unknown) => safeString(day)).filter(Boolean)
      : [];
    const days = sourceDays.length ? sourceDays : [""];
    return days.map((day: string, index: number) => ({
      id: index === 0
        ? safeString(deviation?.id)
        : `${safeString(deviation?.id)}_${day.replaceAll("-", "")}`,
      userId: normalizeId(deviation?.userId),
      type: safeString(deviation?.type).toLowerCase() as CrewDeviationType,
      days: day ? [day] : [],
      startTime: safeString(deviation?.startTime) || null,
      endTime: safeString(deviation?.endTime) || null,
      global: GLOBAL_CREW_DEVIATION_TYPES.has(
        safeString(deviation?.type).toLowerCase() as CrewDeviationType,
      ),
      note: safeString(deviation?.note),
      replacementUserId: normalizeId(deviation?.replacementUserId) || null,
      actorName: safeString(deviation?.actorName),
      at: deviation?.at instanceof Date && !Number.isNaN(deviation.at.getTime())
        ? deviation.at.toISOString()
        : safeString(deviation?.at),
    }));
  });
}

export function getPlannedExecutionWindow(args: {
  userId: string;
  day: string;
  extraAssignments: unknown;
  scheduledStart: unknown;
  scheduledEnd: unknown;
  workingDays?: unknown;
  taskStartTime?: unknown;
  taskEndTime?: unknown;
}) {
  const taskStart = dateOnly(args.scheduledStart);
  const taskEnd = dateOnly(args.scheduledEnd) || taskStart;
  if (!taskStart || !taskEnd || args.day < taskStart || args.day > taskEnd) return null;
  const workingDays = Array.isArray(args.workingDays)
    ? new Set(args.workingDays.map(validDateOnly).filter((day): day is string => !!day))
    : new Set(deriveExecutionWorkingDays({
        scheduledStart: args.scheduledStart,
        scheduledEnd: args.scheduledEnd,
      }));
  if (!workingDays.has(args.day)) return null;
  const assignment = normalizeStoredExtraAssignments(args.extraAssignments)
    .find((item) => item.userId === args.userId);
  if (assignment) {
    const assignmentDays = assignment.days ?? assignment.dayWindows?.map((window) => window.day);
    if (assignmentDays && !assignmentDays.includes(args.day)) return null;
    const dayWindow = assignment.dayWindows?.find((window) => window.day === args.day);
    if (dayWindow) {
      return { startTime: dayWindow.startTime, endTime: dayWindow.endTime };
    }
    return { startTime: assignment.startTime, endTime: assignment.endTime };
  }
  return {
    startTime: safeString(args.taskStartTime) || null,
    endTime: safeString(args.taskEndTime) || null,
  };
}

function normalizeDeviationTimePair(deviation: any) {
  const startTime = deviation?.startTime == null || deviation?.startTime === ""
    ? null
    : safeString(deviation.startTime);
  const endTime = deviation?.endTime == null || deviation?.endTime === ""
    ? null
    : safeString(deviation.endTime);
  if ((startTime == null) !== (endTime == null)) {
    throw new ExecutionCrewRequestError(
      "Bei einer Abweichung müssen startTime und endTime gemeinsam gesetzt werden.",
      "INCOMPLETE_DEVIATION_TIME",
    );
  }
  if (startTime && (!TIME_RE.test(startTime) || !TIME_RE.test(endTime!))) {
    throw new ExecutionCrewRequestError(
      "Abweichungszeiten müssen das Format HH:mm haben.",
      "INVALID_DEVIATION_TIME",
    );
  }
  if (startTime && endTime && startTime >= endTime) {
    throw new ExecutionCrewRequestError(
      "Bei einer Abweichung muss endTime nach startTime liegen.",
      "INVALID_DEVIATION_TIME_RANGE",
    );
  }
  return { startTime, endTime };
}

export async function normalizeAndValidateCrewDeviations(args: {
  db: Db;
  companyId: string;
  input: unknown;
  scheduledStart: unknown;
  scheduledEnd: unknown;
  workingDays?: unknown;
  taskStartTime?: unknown;
  taskEndTime?: unknown;
  extraAssignments?: unknown;
  actorName: string;
  now?: Date;
}) {
  if (!Array.isArray(args.input)) {
    throw new ExecutionCrewRequestError(
      "crewDeviations muss ein Array sein.",
      "INVALID_CREW_DEVIATIONS",
    );
  }
  if (args.input.length === 0) {
    return { crewDeviations: [] as CrewDeviation[], users: [] as any[] };
  }
  const taskStart = dateOnly(args.scheduledStart);
  const taskEnd = dateOnly(args.scheduledEnd) || taskStart;
  if (!taskStart || !taskEnd || taskStart > taskEnd) {
    throw new ExecutionCrewRequestError(
      "crewDeviations benötigen einen gültigen Termin-Zeitraum.",
      "INVALID_SCHEDULE_RANGE",
    );
  }
  const workingDays = new Set(
    Array.isArray(args.workingDays)
      ? args.workingDays.map(validDateOnly).filter((day): day is string => !!day)
      : deriveExecutionWorkingDays({
          scheduledStart: args.scheduledStart,
          scheduledEnd: args.scheduledEnd,
        }),
  );

  const nowIso = (args.now ?? new Date()).toISOString();
  const seenKeys = new Set<string>();
  const seenUserDays = new Set<string>();
  const allUserIds = new Set<string>();
  const normalized = args.input.map((deviation: any) => {
    const id = safeString(deviation?.id);
    if (!id || id.length > 100) {
      throw new ExecutionCrewRequestError(
        "Eine Abweichung benötigt eine gültige stabile ID.",
        "INVALID_DEVIATION_ID",
      );
    }
    const userId = toObjectIdOrNull(deviation?.userId);
    if (!userId) {
      throw new ExecutionCrewRequestError(
        "Die Mitarbeiter-ID einer Abweichung ist ungültig.",
        "INVALID_DEVIATION_USER",
      );
    }
    const type = safeString(deviation?.type).toLowerCase() as CrewDeviationType;
    if (!CREW_DEVIATION_TYPES.includes(type)) {
      throw new ExecutionCrewRequestError(
        "Unbekannter Abweichungstyp.",
        "UNKNOWN_DEVIATION_TYPE",
      );
    }
    const key = `${userId.toString()}:${id}`;
    if (seenKeys.has(key)) {
      throw new ExecutionCrewRequestError(
        "Eine Abweichungs-ID darf pro Mitarbeiter nur einmal vorkommen.",
        "DUPLICATE_DEVIATION",
      );
    }
    seenKeys.add(key);

    if (!Array.isArray(deviation?.days) || deviation.days.length !== 1) {
      throw new ExecutionCrewRequestError(
        "Eine Abweichung muss genau einen Einsatztag enthalten.",
        "INVALID_DEVIATION_DAYS",
      );
    }
    const seenDays = new Set<string>();
    const days = deviation.days.map((value: unknown) => {
      const day = validDateOnly(value);
      if (!day) {
        throw new ExecutionCrewRequestError(
          "Abweichungstage müssen gültige ISO-Daten (yyyy-mm-dd) sein.",
          "INVALID_DEVIATION_DAY",
        );
      }
      if (day < taskStart || day > taskEnd) {
        throw new ExecutionCrewRequestError(
          "Ein Abweichungstag liegt ausserhalb des Termin-Zeitraums.",
          "DEVIATION_DAY_OUTSIDE_SCHEDULE",
        );
      }
      if (!workingDays.has(day)) {
        throw new ExecutionCrewRequestError(
          "Ein Abweichungstag ist kein Arbeitstag des Auftrags.",
          "DEVIATION_DAY_NOT_WORKING_DAY",
        );
      }
      if (seenDays.has(day)) {
        throw new ExecutionCrewRequestError(
          "Ein Abweichungstag darf nicht doppelt vorkommen.",
          "DUPLICATE_DEVIATION_DAY",
        );
      }
      seenDays.add(day);
      return day;
    });
    const userDayKey = `${userId.toString()}:${days[0]}`;
    if (seenUserDays.has(userDayKey)) {
      throw new ExecutionCrewRequestError(
        "Pro Mitarbeiter und Tag ist maximal eine Abweichung erlaubt.",
        "DUPLICATE_DAY_DEVIATION",
        409,
      );
    }
    seenUserDays.add(userDayKey);
    const { startTime, endTime } = normalizeDeviationTimePair(deviation);
    const plannedWindow = getPlannedExecutionWindow({
      userId: userId.toString(),
      day: days[0],
      extraAssignments: args.extraAssignments,
      scheduledStart: args.scheduledStart,
      scheduledEnd: args.scheduledEnd,
      workingDays: Array.from(workingDays),
      taskStartTime: args.taskStartTime,
      taskEndTime: args.taskEndTime,
    });
    if (!plannedWindow) {
      throw new ExecutionCrewRequestError(
        "Der Mitarbeiter ist an diesem Tag nicht im Einsatz.",
        "DEVIATION_USER_NOT_ASSIGNED_ON_DAY",
      );
    }
    const requiresTimeWindow = [
      "verspaetet",
      "frueher_weg",
      "teilweise_abwesend",
      "arzttermin",
    ].includes(type);
    if (requiresTimeWindow && (!startTime || !endTime)) {
      throw new ExecutionCrewRequestError(
        "Für diesen Abweichungstyp sind startTime und endTime erforderlich.",
        "DEVIATION_TIME_REQUIRED",
      );
    }
    if (startTime && endTime) {
      if (!plannedWindow.startTime || !plannedWindow.endTime) {
        throw new ExecutionCrewRequestError(
          "Für eine zeitliche Abweichung muss die geplante Tageszeit bekannt sein.",
          "PLANNED_DAY_WINDOW_REQUIRED",
        );
      }
      if (startTime < plannedWindow.startTime || endTime > plannedWindow.endTime) {
        throw new ExecutionCrewRequestError(
          "Das Abweichungsfenster muss innerhalb der geplanten Tageszeit liegen.",
          "DEVIATION_OUTSIDE_PLANNED_WINDOW",
        );
      }
      if (type === "verspaetet" && startTime !== plannedWindow.startTime) {
        throw new ExecutionCrewRequestError(
          "Bei Verspätung muss startTime dem geplanten Arbeitsbeginn entsprechen.",
          "INVALID_LATE_WINDOW",
        );
      }
      if (type === "frueher_weg" && endTime !== plannedWindow.endTime) {
        throw new ExecutionCrewRequestError(
          "Bei früherem Weggang muss endTime dem geplanten Arbeitsende entsprechen.",
          "INVALID_EARLY_LEAVE_WINDOW",
        );
      }
    }
    const replacementUserId = deviation?.replacementUserId == null || deviation?.replacementUserId === ""
      ? null
      : toObjectIdOrNull(deviation.replacementUserId);
    if (deviation?.replacementUserId != null && deviation?.replacementUserId !== "" && !replacementUserId) {
      throw new ExecutionCrewRequestError(
        "Die Ersatzmitarbeiter-ID ist ungültig.",
        "INVALID_REPLACEMENT_USER",
      );
    }
    if (replacementUserId?.equals(userId)) {
      throw new ExecutionCrewRequestError(
        "Mitarbeiter und Ersatzmitarbeiter dürfen nicht identisch sein.",
        "DEVIATION_REPLACEMENT_SAME_USER",
      );
    }
    const note = safeString(deviation?.note);
    if (note.length > 1000) {
      throw new ExecutionCrewRequestError(
        "Die Notiz einer Abweichung darf höchstens 1000 Zeichen lang sein.",
        "DEVIATION_NOTE_TOO_LONG",
      );
    }
    const suppliedAt = safeString(deviation?.at);
    const parsedAt = suppliedAt ? new Date(suppliedAt) : null;
    if (suppliedAt && (!parsedAt || Number.isNaN(parsedAt.getTime()))) {
      throw new ExecutionCrewRequestError(
        "at muss ein gültiger ISO-Zeitstempel sein.",
        "INVALID_DEVIATION_TIMESTAMP",
      );
    }
    allUserIds.add(userId.toString());
    if (replacementUserId) allUserIds.add(replacementUserId.toString());
    return {
      id,
      userId: userId.toString(),
      type,
      days,
      startTime,
      endTime,
      global: GLOBAL_CREW_DEVIATION_TYPES.has(type),
      note,
      replacementUserId: replacementUserId?.toString() || null,
      actorName: safeString(deviation?.actorName) || args.actorName,
      at: parsedAt ? parsedAt.toISOString() : nowIso,
    } satisfies CrewDeviation;
  });

  const userIds = Array.from(allUserIds);
  const users = userIds.length ? await getCompanyMembersByIds(args.db, args.companyId, userIds) : [];
  if (users.length !== userIds.length) {
    throw new ExecutionCrewRequestError(
      "Mindestens ein Mitarbeiter oder Ersatzmitarbeiter ist kein aktives Firmenmitglied.",
      "INVALID_DEVIATION_USER",
    );
  }
  return { crewDeviations: normalized, users };
}

export function deriveExtraAssignmentDayWindows(
  assignment: any,
  scheduledStart: unknown,
  scheduledEnd: unknown,
  excludedWeekdays?: unknown,
): ExtraAssignmentDayWindow[] {
  const taskStart = dateOnly(scheduledStart);
  const taskEnd = dateOnly(scheduledEnd) || taskStart;
  if (!taskStart || !taskEnd || taskStart > taskEnd) return [];
  const workingDays = deriveExecutionWorkingDays({
    scheduledStart,
    scheduledEnd,
    excludedWeekdays,
  });
  const workingDaySet = new Set(workingDays);
  const assignmentDays: string[] = Array.isArray(assignment?.days)
    ? (assignment.days as unknown[])
        .map(validDateOnly)
        .filter((day): day is string => !!day && workingDaySet.has(day))
    : workingDays;
  const rawStartTime = safeString(assignment?.startTime);
  const rawEndTime = safeString(assignment?.endTime);
  const hasValidWindow =
    TIME_RE.test(rawStartTime) && TIME_RE.test(rawEndTime) && rawStartTime < rawEndTime;
  return Array.from(new Set(assignmentDays)).map((day) => ({
    day,
    startTime: hasValidWindow ? rawStartTime : null,
    endTime: hasValidWindow ? rawEndTime : null,
  }));
}

export async function migrateExecutionExtraAssignmentDayWindows(db: Db) {
  const tasks = db.collection("executionTasks");
  const docs = await tasks.find({
    extraAssignments: { $elemMatch: { dayWindows: { $exists: false } } },
  }).toArray();
  let modified = 0;
  for (const task of docs) {
    const extraAssignments = (Array.isArray(task?.extraAssignments) ? task.extraAssignments : [])
      .map((assignment: any) => Object.prototype.hasOwnProperty.call(assignment, "dayWindows")
        ? assignment
        : {
            ...assignment,
            dayWindows: deriveExtraAssignmentDayWindows(
              assignment,
              task?.scheduledStart,
              task?.scheduledEnd,
              task?.excludedWeekdays,
            ),
          });
    const result = await tasks.updateOne(
      { _id: task._id, extraAssignments: { $elemMatch: { dayWindows: { $exists: false } } } },
      { $set: { extraAssignments, updatedAt: new Date() } },
    );
    modified += result.modifiedCount;
  }
  return { matched: docs.length, modified };
}

export async function migrateExecutionCrewDeviations(db: Db) {
  const tasks = db.collection("executionTasks");
  const defaultsResult = await tasks.updateMany(
    { crewDeviations: { $exists: false } },
    { $set: { crewDeviations: [] } },
  );
  const legacyDocs = await tasks.find({ "crewDeviations.0": { $exists: true } }).toArray();
  let split = 0;
  for (const task of legacyDocs) {
    const requiresSplit = task.crewDeviations.some(
      (deviation: any) => !Array.isArray(deviation?.days) || deviation.days.length !== 1,
    );
    const normalized = normalizeStoredCrewDeviations(task.crewDeviations);
    if (requiresSplit) {
      const result = await tasks.updateOne(
        { _id: task._id },
        { $set: { crewDeviations: normalized } },
      );
      split += result.modifiedCount;
    }
    const companyId = normalizeId(task?.companyId);
    const taskId = normalizeId(task?._id);
    if (companyId && taskId) {
      await syncCrewDeviationAbsences({
        db,
        companyId,
        taskId,
        crewDeviations: normalized,
      });
    }
  }
  return {
    matched: defaultsResult.matchedCount + legacyDocs.length,
    modified: defaultsResult.modifiedCount + split,
    defaulted: defaultsResult.modifiedCount,
    split,
  };
}

export function buildExtraAssignmentDayWindowHistoryTexts(
  previous: ExtraAssignment | null,
  next: ExtraAssignment,
  userName: string,
) {
  const previousByDay = new Map((previous?.dayWindows ?? []).map((window) => [window.day, window]));
  const nextByDay = new Map((next.dayWindows ?? []).map((window) => [window.day, window]));
  const days = Array.from(new Set([...previousByDay.keys(), ...nextByDay.keys()])).sort();
  return days.flatMap((day) => {
    const before = previousByDay.get(day);
    const after = nextByDay.get(day);
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    const displayDay = day.split("-").reverse().join(".");
    if (!after) return [`Zusatzkraft ${userName}: ${displayDay} Tagesfenster entfernt`];
    const timeText = after.startTime && after.endTime
      ? `${after.startTime}–${after.endTime}`
      : "ganztags";
    return [`Zusatzkraft ${userName}: ${displayDay} auf ${timeText} geändert`];
  });
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

function normalizeDayWindowTimePair(window: any) {
  const startTime = window?.startTime == null || window?.startTime === ""
    ? null
    : safeString(window.startTime);
  const endTime = window?.endTime == null || window?.endTime === ""
    ? null
    : safeString(window.endTime);
  if ((startTime == null) !== (endTime == null)) {
    throw new ExecutionCrewRequestError(
      "Bei einem Tagesfenster müssen startTime und endTime gemeinsam gesetzt oder beide null sein.",
      "INCOMPLETE_EXTRA_ASSIGNMENT_DAY_WINDOW_TIME",
    );
  }
  if (startTime && (!TIME_RE.test(startTime) || !TIME_RE.test(endTime!))) {
    throw new ExecutionCrewRequestError(
      "Tagesfenster müssen das Format HH:mm haben.",
      "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOW_TIME",
    );
  }
  if (startTime && endTime && startTime >= endTime) {
    throw new ExecutionCrewRequestError(
      "Im Tagesfenster muss endTime nach startTime liegen.",
      "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOW_RANGE",
    );
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
  workingDays?: unknown;
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
  const workingDays = new Set(
    Array.isArray(args.workingDays)
      ? args.workingDays.map(validDateOnly).filter((day): day is string => !!day)
      : deriveExecutionWorkingDays({
          scheduledStart: args.scheduledStart,
          scheduledEnd: args.scheduledEnd,
        }),
  );

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
        if (!workingDays.has(day)) {
          throw new ExecutionCrewRequestError(
            "Ein Zusatzkraft-Tag ist kein Arbeitstag des Auftrags.",
            "EXTRA_ASSIGNMENT_DAY_NOT_WORKING_DAY",
          );
        }
        if (seenDays.has(day)) {
          throw new ExecutionCrewRequestError(
            "Ein Zusatzkraft-Tag darf nicht doppelt vorkommen.",
            "DUPLICATE_EXTRA_ASSIGNMENT_DAY",
          );
        }
        seenDays.add(day);
        days.push(day);
      }
    }
    const { startTime, endTime } = normalizeAssignmentTimePair(assignment);
    let dayWindows: ExtraAssignmentDayWindow[] | null = null;
    if (assignment?.dayWindows !== null && assignment?.dayWindows !== undefined) {
      if (!Array.isArray(assignment.dayWindows) || assignment.dayWindows.length === 0) {
        throw new ExecutionCrewRequestError(
          "dayWindows muss null oder eine nicht leere Liste sein.",
          "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOWS",
        );
      }
      const seenWindowDays = new Set<string>();
      dayWindows = assignment.dayWindows.map((window: any) => {
        const day = validDateOnly(window?.day);
        if (!day) {
          throw new ExecutionCrewRequestError(
            "Tagesfenster-Tage müssen gültige ISO-Daten (yyyy-mm-dd) sein.",
            "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOW_DAY",
          );
        }
        if (!taskStart || !taskEnd || day < taskStart || day > taskEnd) {
          throw new ExecutionCrewRequestError(
            "Ein Tagesfenster liegt ausserhalb des Termin-Zeitraums.",
            "EXTRA_ASSIGNMENT_DAY_WINDOW_OUTSIDE_SCHEDULE",
          );
        }
        if (!workingDays.has(day)) {
          throw new ExecutionCrewRequestError(
            "Ein Tagesfenster ist kein Arbeitstag des Auftrags.",
            "EXTRA_ASSIGNMENT_DAY_WINDOW_NOT_WORKING_DAY",
          );
        }
        if (seenWindowDays.has(day)) {
          throw new ExecutionCrewRequestError(
            "Ein Tag darf in dayWindows pro Zusatzkraft nur einmal vorkommen.",
            "DUPLICATE_EXTRA_ASSIGNMENT_DAY_WINDOW",
          );
        }
        if (days && !days.includes(day)) {
          throw new ExecutionCrewRequestError(
            "Ein Tagesfenster muss in days enthalten sein.",
            "EXTRA_ASSIGNMENT_DAY_WINDOW_NOT_IN_DAYS",
          );
        }
        seenWindowDays.add(day);
        return { day, ...normalizeDayWindowTimePair(window) };
      });
      if (!days) days = dayWindows!.map((window) => window.day);
    }
    const note = safeString(assignment?.note);
    if (note.length > 1000) {
      throw new ExecutionCrewRequestError("Die Notiz einer Zusatzkraft darf höchstens 1000 Zeichen lang sein.", "EXTRA_ASSIGNMENT_NOTE_TOO_LONG");
    }
    const replacementForDeviationIds = Array.isArray(assignment?.replacementForDeviationIds)
      ? Array.from(new Set(
          assignment.replacementForDeviationIds
            .map((value: unknown) => safeString(value))
            .filter(Boolean),
        ))
      : undefined;
    return {
      userId,
      role,
      sourceTeamId,
      days,
      startTime,
      endTime,
      dayWindows,
      note,
      ...(replacementForDeviationIds ? { replacementForDeviationIds } : {}),
    };
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
      dayWindows: assignment.dayWindows,
      note: assignment.note,
      ...(assignment.replacementForDeviationIds
        ? { replacementForDeviationIds: assignment.replacementForDeviationIds }
        : {}),
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

export function getExecutionUserBooking(task: any, userId: string): ExecutionBooking | null {
  const assignment = normalizeStoredExtraAssignments(task?.extraAssignments)
    .find((item) => item.userId === userId);
  const start = dateOnly(task?.scheduledStart);
  const end = dateOnly(task?.scheduledEnd) || start;
  if (!start || !end || start > end) return null;
  const taskStartTime = safeString(task?.startTime) || null;
  const taskEndTime = safeString(task?.endTime) || null;
  const taskWorkingDays = getExecutionWorkingDays(task);
  const taskWorkingDaySet = new Set(taskWorkingDays);
  const assignmentDays = assignment?.days ?? assignment?.dayWindows?.map((window) => window.day);
  const unavailableWindows = normalizeStoredCrewDeviations(task?.crewDeviations)
    .filter((deviation) => deviation.userId === userId)
    .flatMap((deviation) => deviation.days.map((day) => ({
      day,
      startTime: deviation.startTime,
      endTime: deviation.endTime,
    })));
  return {
    days: assignmentDays
      ? assignmentDays.filter((day) => taskWorkingDaySet.has(day))
      : taskWorkingDays,
    startTime: assignment?.startTime ?? taskStartTime,
    endTime: assignment?.endTime ?? taskEndTime,
    dayWindows: assignment?.dayWindows ?? null,
    unavailableWindows,
  };
}

function timeMinutes(value: string | null) {
  if (!value || !TIME_RE.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getExecutionBookingOverlap(
  left: ExecutionBooking | null,
  right: ExecutionBooking | null,
) {
  return getExecutionBookingOverlapDetails(left, right).map((overlap) => overlap.day);
}

function getBookingWindow(booking: ExecutionBooking, day: string) {
  const dayWindow = booking.dayWindows?.find((window) => window.day === day);
  return dayWindow
    ? { startTime: dayWindow.startTime, endTime: dayWindow.endTime }
    : { startTime: booking.startTime, endTime: booking.endTime };
}

function getEffectiveBookingIntervals(booking: ExecutionBooking, day: string) {
  const window = getBookingWindow(booking, day);
  const start = timeMinutes(window.startTime) ?? 0;
  const end = timeMinutes(window.endTime) ?? 24 * 60;
  let intervals: Array<[number, number]> = [[start, end]];
  for (const unavailable of booking.unavailableWindows?.filter((item) => item.day === day) ?? []) {
    const unavailableStart = timeMinutes(unavailable.startTime) ?? 0;
    const unavailableEnd = timeMinutes(unavailable.endTime) ?? 24 * 60;
    intervals = intervals.flatMap(([intervalStart, intervalEnd]) => {
      if (unavailableEnd <= intervalStart || unavailableStart >= intervalEnd) {
        return [[intervalStart, intervalEnd] as [number, number]];
      }
      const remaining: Array<[number, number]> = [];
      if (unavailableStart > intervalStart) remaining.push([intervalStart, unavailableStart]);
      if (unavailableEnd < intervalEnd) remaining.push([unavailableEnd, intervalEnd]);
      return remaining;
    });
  }
  return intervals;
}

export function getExecutionBookingOverlapDetails(
  left: ExecutionBooking | null,
  right: ExecutionBooking | null,
) {
  if (!left || !right) return [];
  const rightDays = new Set(right.days);
  const overlappingDays = left.days.filter((day) => rightDays.has(day));
  if (!overlappingDays.length) return [];
  return overlappingDays.flatMap((day) => {
    const rightWindow = getBookingWindow(right, day);
    const leftIntervals = getEffectiveBookingIntervals(left, day);
    const rightIntervals = getEffectiveBookingIntervals(right, day);
    const overlaps = leftIntervals.some(([leftStart, leftEnd]) =>
      rightIntervals.some(([rightStart, rightEnd]) =>
        leftStart < rightEnd && rightStart < leftEnd,
      ),
    );
    return overlaps ? [{
      day,
      startTime: rightWindow.startTime,
      endTime: rightWindow.endTime,
    }] : [];
  });
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
  await ensureAbsenceIndexes(args.db);
  const absenceFilter = {
    companyId: { $in: buildIdVariants(args.companyId) },
    userId: { $in: userIds.flatMap(buildIdVariants) },
    ...buildAbsenceOverlapFilter(allDays[0], allDays.at(-1)!),
  };
  const [candidates, absences] = await Promise.all([
    args.db.collection("executionTasks").find(candidateFilter).toArray(),
    getAbsencesCollection(args.db).find(absenceFilter).toArray(),
  ]);

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
      const overlaps = getExecutionBookingOverlapDetails(bookings.get(userId) ?? null, candidateBooking);
      if (!overlaps.length) continue;
      const planning = planningById.get(normalizeId(candidate?.planningId));
      const projectName =
        safeString(candidate?.planningTitle) ||
        safeString(planning?.title) ||
        safeString(planning?.summary?.customerName) ||
        safeString(planning?.planningNumber) ||
        safeString(candidate?.projectNumber) ||
        "Unbekanntes Projekt";
      for (const overlap of overlaps) {
        conflicts.push({
          type: "task",
          userId,
          conflictingTaskId: normalizeId(candidate?._id),
          projectName,
          day: overlap.day,
          days: [overlap.day],
          startTime: overlap.startTime,
          endTime: overlap.endTime,
        });
      }
    }
  }
  for (const absence of absences) {
    if (taskId && normalizeId(absence?.sourceTaskId) === taskId) continue;
    const userId = normalizeId(absence?.userId);
    const requestedBooking = bookings.get(userId) ?? null;
    if (!requestedBooking) continue;
    const absenceBooking = getAbsenceBooking(absence);
    const overlaps = getExecutionBookingOverlapDetails(requestedBooking, absenceBooking);
    for (const overlap of overlaps) {
      conflicts.push({
        type: "absence",
        userId,
        absenceId: normalizeId(absence?._id),
        reason: safeString(absence?.reason).toLowerCase(),
        startDate: safeString(absence?.startDate),
        endDate: safeString(absence?.endDate),
        day: overlap.day,
        days: [overlap.day],
        startTime: overlap.startTime,
        endTime: overlap.endTime,
      });
    }
  }
  return conflicts;
}

export function getExecutionCrewMutationLockIds(companyId: string, tasks: any[]) {
  const result = new Set<string>();
  for (const task of tasks) {
    const userIds = Array.from(new Set<string>(
      Array.isArray(task?.assignedUserIds)
        ? task.assignedUserIds.map(normalizeId).filter(Boolean)
        : [],
    ));
    for (const userId of userIds) {
      const booking = getExecutionUserBooking(task, userId);
      for (const day of booking?.days ?? []) {
        result.add(`${companyId}:${userId}:${day}`);
      }
    }
  }
  return Array.from(result).sort();
}

export async function withExecutionCrewMutationLocks<T>(args: {
  db: Db;
  lockIds: string[];
  run: () => Promise<T>;
}) {
  if (!args.lockIds.length) return args.run();
  const locks = args.db.collection<any>("executionCrewMutationLocks");
  await locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const ownerId = new ObjectId().toString();
  const acquired: string[] = [];
  try {
    for (const lockId of args.lockIds) {
      const now = new Date();
      await locks.deleteOne({ _id: lockId, expiresAt: { $lte: now } });
      try {
        await locks.insertOne({
          _id: lockId,
          ownerId,
          expiresAt: new Date(now.getTime() + 30_000),
        });
        acquired.push(lockId);
      } catch (error: any) {
        if (error?.code === 11000) {
          throw new ExecutionCrewRequestError(
            "Die Einsatzplanung wird gerade gleichzeitig geändert. Bitte erneut versuchen.",
            "CREW_UPDATE_IN_PROGRESS",
            409,
          );
        }
        throw error;
      }
    }
    return await args.run();
  } finally {
    if (acquired.length) {
      await locks.deleteMany({ _id: { $in: acquired }, ownerId }).catch(() => undefined);
    }
  }
}
