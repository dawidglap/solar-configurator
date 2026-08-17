import { ObjectId, type Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { buildIdVariants } from "@/lib/tasks";
import type { CrewDeviation } from "@/lib/executionCrew";

export const ABSENCE_REASONS = [
  "krankheit",
  "unfall",
  "ferien",
  "militaer",
  "weiterbildung",
  "anderes",
  "andere_baustelle",
  "sonstiges",
] as const;

export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

export type AbsenceBooking = {
  days: string[];
  startTime: string | null;
  endTime: string | null;
};

export class AbsenceRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_ABSENCE", status = 400) {
    super(message);
    this.name = "AbsenceRequestError";
    this.status = status;
    this.code = code;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ensureIndexPromises = new WeakMap<Db, Promise<void>>();

export function getAbsencesCollection(db: Db) {
  return db.collection("absences");
}

export async function ensureAbsenceIndexes(db: Db) {
  const existing = ensureIndexPromises.get(db);
  if (existing) return existing;

  const absences = getAbsencesCollection(db);
  const pending = Promise.all([
    absences.createIndex({ companyId: 1, userId: 1, startDate: 1 }),
    absences.createIndex({ companyId: 1, startDate: 1 }),
    absences.createIndex({ companyId: 1, sourceTaskId: 1, sourceDeviationId: 1, userId: 1 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureIndexPromises.delete(db);
      throw error;
    });
  ensureIndexPromises.set(db, pending);
  return pending;
}

export function parseAbsenceDate(value: unknown) {
  const normalized = safeString(value);
  if (!DATE_ONLY_RE.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    return null;
  }
  return normalized;
}

export function normalizeAbsenceReason(value: unknown): AbsenceReason | null {
  const normalized = safeString(value).toLowerCase() as AbsenceReason;
  return ABSENCE_REASONS.includes(normalized) ? normalized : null;
}

function normalizeTimePair(startValue: unknown, endValue: unknown) {
  const startTime = startValue == null || startValue === "" ? null : safeString(startValue);
  const endTime = endValue == null || endValue === "" ? null : safeString(endValue);
  if (startTime == null && endTime == null) return { startTime: null, endTime: null };
  if (startTime == null || endTime == null) {
    throw new AbsenceRequestError(
      "startTime und endTime müssen gemeinsam angegeben werden.",
      "INCOMPLETE_TIME_RANGE",
    );
  }
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    throw new AbsenceRequestError(
      "startTime und endTime müssen im Format HH:mm angegeben werden.",
      "INVALID_TIME",
    );
  }
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    throw new AbsenceRequestError("endTime muss nach startTime liegen.", "INVALID_TIME_RANGE");
  }
  return { startTime, endTime };
}

export function normalizeAbsenceInput(input: any) {
  const userId = toObjectIdOrNull(input?.userId);
  if (!userId) {
    throw new AbsenceRequestError("Ungültige Mitarbeiter-ID.", "INVALID_USER_ID");
  }

  const startDate = parseAbsenceDate(input?.startDate);
  if (!startDate) {
    throw new AbsenceRequestError(
      "startDate muss ein gültiges Datum im Format YYYY-MM-DD sein.",
      "INVALID_START_DATE",
    );
  }
  const endDate = input?.endDate == null || input?.endDate === ""
    ? startDate
    : parseAbsenceDate(input.endDate);
  if (!endDate) {
    throw new AbsenceRequestError(
      "endDate muss ein gültiges Datum im Format YYYY-MM-DD sein.",
      "INVALID_END_DATE",
    );
  }
  if (endDate < startDate) {
    throw new AbsenceRequestError("endDate darf nicht vor startDate liegen.", "INVALID_DATE_RANGE");
  }

  const reason = normalizeAbsenceReason(input?.reason);
  if (!reason) {
    throw new AbsenceRequestError("Unbekannter Abwesenheitsgrund.", "UNKNOWN_REASON");
  }

  const { startTime, endTime } = normalizeTimePair(input?.startTime, input?.endTime);
  const rawSourceTaskId = input?.sourceTaskId;
  const sourceTaskId = rawSourceTaskId == null || rawSourceTaskId === ""
    ? null
    : toObjectIdOrNull(rawSourceTaskId);
  if (rawSourceTaskId != null && rawSourceTaskId !== "" && !sourceTaskId) {
    throw new AbsenceRequestError("Ungültige sourceTaskId.", "INVALID_SOURCE_TASK_ID");
  }

  return {
    userId,
    startDate,
    endDate,
    startTime,
    endTime,
    reason,
    note: safeString(input?.note),
    sourceTaskId,
  };
}

function enumerateDays(startDate: string, endDate: string) {
  const result: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const last = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function getAbsenceBooking(absence: any): AbsenceBooking | null {
  const startDate = parseAbsenceDate(absence?.startDate);
  const endDate = parseAbsenceDate(absence?.endDate) || startDate;
  if (!startDate || !endDate || endDate < startDate) return null;
  const startTime = TIME_RE.test(safeString(absence?.startTime)) ? safeString(absence.startTime) : null;
  const endTime = TIME_RE.test(safeString(absence?.endTime)) ? safeString(absence.endTime) : null;
  return {
    days: enumerateDays(startDate, endDate),
    startTime: startTime && endTime ? startTime : null,
    endTime: startTime && endTime ? endTime : null,
  };
}

export function isAbsenceFromTask(absence: any, taskId: unknown) {
  const normalizedTaskId = mongoIdToString(taskId) || safeString(taskId);
  if (!normalizedTaskId) return false;
  return (mongoIdToString(absence?.sourceTaskId) || safeString(absence?.sourceTaskId)) === normalizedTaskId;
}

export function serializeAbsence(doc: any) {
  return {
    id: mongoIdToString(doc?._id),
    userId: mongoIdToString(doc?.userId),
    startDate: parseAbsenceDate(doc?.startDate) || safeString(doc?.startDate),
    endDate: parseAbsenceDate(doc?.endDate) || safeString(doc?.endDate),
    startTime: safeString(doc?.startTime) || null,
    endTime: safeString(doc?.endTime) || null,
    reason: normalizeAbsenceReason(doc?.reason) || safeString(doc?.reason).toLowerCase(),
    note: safeString(doc?.note),
    sourceTaskId: mongoIdToString(doc?.sourceTaskId) || null,
    ...(safeString(doc?.sourceDeviationId)
      ? { sourceDeviationId: safeString(doc.sourceDeviationId) }
      : {}),
  };
}

function crewDeviationAbsenceReason(type: CrewDeviation["type"]): AbsenceReason {
  if (type === "krank" || type === "unfall") return "krankheit";
  if (type === "ferien") return "ferien";
  return "anderes";
}

export async function syncCrewDeviationAbsences(args: {
  db: Db;
  companyId: string;
  taskId: string;
  crewDeviations: CrewDeviation[];
  actorUserId?: string | null;
}) {
  await ensureAbsenceIndexes(args.db);
  const companyId = toObjectIdOrNull(args.companyId);
  const taskId = toObjectIdOrNull(args.taskId);
  if (!companyId || !taskId) {
    throw new AbsenceRequestError(
      "Abweichungs-Abwesenheiten konnten nicht zugeordnet werden.",
      "INVALID_DEVIATION_ABSENCE_SCOPE",
    );
  }
  const actorUserId = toObjectIdOrNull(args.actorUserId);
  const collection = getAbsencesCollection(args.db);
  const desired = args.crewDeviations.filter((deviation) => deviation.global);
  const desiredKeys = new Set(desired.map((deviation) => `${deviation.userId}:${deviation.id}`));
  const scope = {
    companyId: { $in: buildIdVariants(args.companyId) },
    sourceTaskId: { $in: buildIdVariants(args.taskId) },
    sourceDeviationId: { $exists: true },
  };

  const existing = await collection.find(
    scope,
    { projection: { _id: 1, sourceDeviationId: 1, userId: 1 } },
  ).toArray();
  const staleIds = existing
    .filter((absence) => !desiredKeys.has(
      `${mongoIdToString(absence?.userId)}:${safeString(absence?.sourceDeviationId)}`,
    ))
    .map((absence) => absence._id);
  if (staleIds.length) await collection.deleteMany({ _id: { $in: staleIds } });

  const now = new Date();
  for (const deviation of desired) {
    const days = [...deviation.days].sort();
    await collection.updateOne(
      {
        companyId: { $in: buildIdVariants(args.companyId) },
        sourceTaskId: { $in: buildIdVariants(args.taskId) },
        sourceDeviationId: deviation.id,
        userId: { $in: buildIdVariants(deviation.userId) },
      },
      {
        $set: {
          companyId,
          userId: new ObjectId(deviation.userId),
          startDate: days[0],
          endDate: days.at(-1),
          startTime: deviation.startTime,
          endTime: deviation.endTime,
          reason: crewDeviationAbsenceReason(deviation.type),
          note: deviation.note,
          sourceTaskId: taskId,
          sourceDeviationId: deviation.id,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          createdByUserId: actorUserId,
        },
      },
      { upsert: true },
    );
  }
  return { upserted: desired.length, removed: staleIds.length };
}

export async function cleanupOrphanedCrewDeviationAbsences(
  db: Db,
  companyId?: string,
) {
  const collection = getAbsencesCollection(db);
  const scope: Record<string, any> = {
    sourceTaskId: { $exists: true, $ne: null },
    sourceDeviationId: { $exists: true, $ne: "" },
  };
  if (companyId) scope.companyId = { $in: buildIdVariants(companyId) };
  const absences = await collection.find(scope, {
    projection: { _id: 1, companyId: 1, userId: 1, sourceTaskId: 1, sourceDeviationId: 1 },
  }).toArray();
  if (!absences.length) return { matched: 0, removed: 0 };

  const taskIds = Array.from(new Set(
    absences.map((absence) => mongoIdToString(absence?.sourceTaskId)).filter(Boolean),
  ));
  const tasks = taskIds.length
    ? await db.collection("executionTasks").find(
        { _id: { $in: taskIds.map((taskId) => new ObjectId(taskId)) } },
        { projection: { companyId: 1, crewDeviations: 1 } },
      ).toArray()
    : [];
  const taskById = new Map(tasks.map((task) => [mongoIdToString(task?._id), task]));
  const staleIds = absences.filter((absence) => {
    const task = taskById.get(mongoIdToString(absence?.sourceTaskId));
    if (!task) return true;
    const absenceCompanyId = mongoIdToString(absence?.companyId) || safeString(absence?.companyId);
    const taskCompanyId = mongoIdToString(task?.companyId) || safeString(task?.companyId);
    if (!absenceCompanyId || absenceCompanyId !== taskCompanyId) return true;
    const sourceDeviationId = safeString(absence?.sourceDeviationId);
    const userId = mongoIdToString(absence?.userId) || safeString(absence?.userId);
    return !normalizeCrewDeviationKeys(task?.crewDeviations).has(`${userId}:${sourceDeviationId}`);
  }).map((absence) => absence._id);
  if (staleIds.length) await collection.deleteMany({ _id: { $in: staleIds } });
  return { matched: absences.length, removed: staleIds.length };
}

export async function migrateAbsenceDefaults(db: Db) {
  const result = await getAbsencesCollection(db).updateMany(
    { sourceTaskId: { $exists: false } },
    { $set: { sourceTaskId: null, updatedAt: new Date() } },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

function normalizeCrewDeviationKeys(input: unknown) {
  if (!Array.isArray(input)) return new Set<string>();
  return new Set(input.map((deviation: any) => {
    const userId = mongoIdToString(deviation?.userId) || safeString(deviation?.userId);
    return `${userId}:${safeString(deviation?.id)}`;
  }));
}

export function buildAbsenceOverlapFilter(from: string, to: string) {
  return {
    startDate: { $lte: to },
    endDate: { $gte: from },
  };
}
