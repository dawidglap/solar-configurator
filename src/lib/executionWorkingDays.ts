import { safeString } from "@/lib/api-session";

export const DEFAULT_EXECUTION_EXCLUDED_WEEKDAYS = [0, 6] as const;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ExecutionWorkingDaysError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "INVALID_WORKING_DAYS", status = 400) {
    super(message);
    this.name = "ExecutionWorkingDaysError";
    this.code = code;
    this.status = status;
  }
}

function zurichDateOnly(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function normalizeExecutionDateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = safeString(value);
  if (!raw) return null;
  if (DATE_ONLY_RE.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw
      ? raw
      : null;
  }
  const leadingDate = raw.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
  if (leadingDate && DATE_ONLY_RE.test(leadingDate)) {
    const parsedLeadingDate = new Date(`${leadingDate}T00:00:00.000Z`);
    if (parsedLeadingDate.toISOString().slice(0, 10) === leadingDate) return leadingDate;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : zurichDateOnly(parsed);
}

export function normalizeExcludedWeekdays(
  value: unknown,
  fallback: readonly number[] = DEFAULT_EXECUTION_EXCLUDED_WEEKDAYS,
) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new ExecutionWorkingDaysError(
      "excludedWeekdays muss ein Array sein.",
      "INVALID_EXCLUDED_WEEKDAYS",
    );
  }
  const normalized = value.map((weekday) => Number(weekday));
  if (normalized.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    throw new ExecutionWorkingDaysError(
      "excludedWeekdays darf nur ganze Zahlen von 0 bis 6 enthalten.",
      "INVALID_EXCLUDED_WEEKDAYS",
    );
  }
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

export function deriveExecutionWorkingDays(args: {
  scheduledStart: unknown;
  scheduledEnd: unknown;
  excludedWeekdays?: unknown;
}) {
  const start = normalizeExecutionDateOnly(args.scheduledStart);
  const end = normalizeExecutionDateOnly(args.scheduledEnd) || start;
  const excludedWeekdays = normalizeExcludedWeekdays(args.excludedWeekdays);
  if (!start || !end) return [] as string[];
  if (start > end) {
    throw new ExecutionWorkingDaysError(
      "scheduledEnd darf nicht vor scheduledStart liegen.",
      "INVALID_SCHEDULE_RANGE",
    );
  }
  const excluded = new Set(excludedWeekdays);
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    if (!excluded.has(cursor.getUTCDay())) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function normalizeProvidedWorkingDays(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ExecutionWorkingDaysError(
      "workingDays muss ein Array sein.",
      "INVALID_WORKING_DAYS",
    );
  }
  const days = value.map((day) => {
    const normalized = normalizeExecutionDateOnly(day);
    if (!normalized || safeString(day) !== normalized) {
      throw new ExecutionWorkingDaysError(
        "workingDays darf nur gültige ISO-Tage (yyyy-mm-dd) enthalten.",
        "INVALID_WORKING_DAY",
      );
    }
    return normalized;
  });
  if (new Set(days).size !== days.length) {
    throw new ExecutionWorkingDaysError(
      "workingDays darf keine doppelten Tage enthalten.",
      "DUPLICATE_WORKING_DAY",
    );
  }
  return [...days].sort();
}

export function resolveExecutionWorkingDayFields(args: {
  scheduledStart: unknown;
  scheduledEnd: unknown;
  excludedWeekdays?: unknown;
  workingDays?: unknown;
  validateProvided?: boolean;
}) {
  const excludedWeekdays = normalizeExcludedWeekdays(args.excludedWeekdays);
  const derivedWorkingDays = deriveExecutionWorkingDays({
    scheduledStart: args.scheduledStart,
    scheduledEnd: args.scheduledEnd,
    excludedWeekdays,
  });
  if (args.workingDays !== undefined && args.validateProvided !== false) {
    const providedWorkingDays = normalizeProvidedWorkingDays(args.workingDays);
    if (
      providedWorkingDays.length !== derivedWorkingDays.length ||
      providedWorkingDays.some((day, index) => day !== derivedWorkingDays[index])
    ) {
      throw new ExecutionWorkingDaysError(
        "workingDays muss dem Termin-Zeitraum abzüglich excludedWeekdays entsprechen.",
        "WORKING_DAYS_MISMATCH",
      );
    }
  }
  return { excludedWeekdays, workingDays: derivedWorkingDays };
}

export function getExecutionWorkingDays(task: any) {
  return resolveExecutionWorkingDayFields({
    scheduledStart: task?.scheduledStart,
    scheduledEnd: task?.scheduledEnd,
    excludedWeekdays: task?.excludedWeekdays,
    validateProvided: false,
  }).workingDays;
}
