import type { Db } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import {
  buildCalendarEventCreatedBy,
  ensureCalendarEventIndexes,
  getCalendarEventsCollection,
  resolveCalendarEventAssignees,
} from "@/lib/calendarEvents";
import { getExecutionTasksCollection, normalizeExecutionStage } from "@/lib/executionTasks";
import { getExecutionWorkingDays } from "@/lib/executionWorkingDays";
import { buildIdVariants } from "@/lib/tasks";

export const HEATING_EXECUTION_CALENDAR_SOURCE = "execution_task" as const;
export const HEATING_EXECUTION_CALENDAR_TRACK = "heating" as const;

function buildManagedEventFilter(companyId: string, taskId: string) {
  return {
    companyId,
    managedSource: HEATING_EXECUTION_CALENDAR_SOURCE,
    executionTrack: HEATING_EXECUTION_CALENDAR_TRACK,
    linkedTaskId: taskId,
  };
}

function normalizeStoredUserIds(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  return Array.from(
    new Set(
      values
        .map((value) => mongoIdToString(value) || safeString(value))
        .filter(Boolean),
    ),
  );
}

function resolveCalendarTimes(task: any) {
  const startTime = safeString(task?.startTime) || null;
  const endTime = safeString(task?.endTime) || null;
  return {
    startTime,
    endTime,
    allDay: !startTime && !endTime,
  };
}

async function resolveHeatingCalendarContext(
  db: Db,
  companyId: string,
  task: any,
) {
  const planningId = mongoIdToString(task?.planningId) || safeString(task?.planningId);
  const planningObjectId = toObjectIdOrNull(planningId);
  const planning = planningObjectId
    ? await db.collection("plannings").findOne({
        _id: planningObjectId,
        companyId: { $in: buildIdVariants(companyId) },
      })
    : null;
  const customerId =
    mongoIdToString(task?.customerId) ||
    safeString(task?.customerId) ||
    mongoIdToString(planning?.customerId) ||
    safeString(planning?.customerId) ||
    null;
  const customerObjectId = toObjectIdOrNull(customerId);
  const customer = customerObjectId
    ? await db.collection("customers").findOne({
        _id: customerObjectId,
        companyId: { $in: buildIdVariants(companyId) },
      })
    : null;
  const customerName =
    safeString(planning?.summary?.customerName) ||
    safeString(customer?.name) ||
    [safeString(customer?.firstName), safeString(customer?.lastName)]
      .filter(Boolean)
      .join(" ") ||
    safeString(customer?.companyName);
  const projectLabel =
    customerName ||
    safeString(planning?.planningNumber) ||
    safeString(planning?.title) ||
    safeString(task?.projectId) ||
    planningId;

  return {
    title: projectLabel ? `Heizung · ${projectLabel}` : "Heizung",
    planningId,
    projectId:
      mongoIdToString(task?.projectId) ||
      safeString(task?.projectId) ||
      planningId,
    customerId,
  };
}

/**
 * Projects one canonical Heating execution schedule into calendar_events.
 * PV tasks and manual calendar events are deliberately left untouched.
 */
export async function syncHeatingExecutionCalendarForTask(args: {
  db: Db;
  companyId: string;
  taskId: string;
  session?: SessionPayload | null;
}) {
  const taskObjectId = toObjectIdOrNull(args.taskId);
  if (!taskObjectId) {
    throw new Error("Execution task not found");
  }
  const companyId = safeString(args.companyId);
  const task = await getExecutionTasksCollection(args.db).findOne({
    _id: taskObjectId,
    companyId: { $in: buildIdVariants(companyId) },
  });
  if (!task) {
    throw new Error("Execution task not found");
  }
  if (safeString(task.track) !== HEATING_EXECUTION_CALENDAR_TRACK) {
    return { managed: false, created: 0, updated: 0, deleted: 0, items: [] as any[] };
  }

  await ensureCalendarEventIndexes(args.db);
  const taskId = mongoIdToString(task._id);
  const managedFilter = buildManagedEventFilter(companyId, taskId);
  const calendarEvents = getCalendarEventsCollection(args.db);
  const workingDays = getExecutionWorkingDays(task);

  if (!workingDays.length) {
    const removed = await calendarEvents.deleteMany(managedFilter);
    return {
      managed: true,
      created: 0,
      updated: 0,
      deleted: removed.deletedCount,
      items: [] as any[],
    };
  }

  const [context, assignment] = await Promise.all([
    resolveHeatingCalendarContext(args.db, companyId, task),
    resolveCalendarEventAssignees(
      args.db,
      companyId,
      normalizeStoredUserIds(task.assignedUserIds),
    ),
  ]);
  const createdBy = buildCalendarEventCreatedBy((args.session ?? {}) as SessionPayload);
  const times = resolveCalendarTimes(task);
  const stage = normalizeExecutionStage(task.stage) ?? "offen";
  const now = new Date();
  let created = 0;
  let updated = 0;

  for (const occurrenceDate of workingDays) {
    const result = await calendarEvents.updateOne(
      { ...managedFilter, occurrenceDate },
      {
        $setOnInsert: {
          createdAt: now,
          createdByUserId: createdBy.createdByUserId,
          createdByName: createdBy.createdByName,
        },
        $set: {
          title: context.title,
          description: null,
          notes: null,
          startDate: occurrenceDate,
          endDate: occurrenceDate,
          ...times,
          assigneeUserIds: assignment.assigneeUserIds,
          assignees: assignment.assignees,
          linkedPlanningId: context.planningId || null,
          linkedProjectId: context.projectId || null,
          linkedCustomerId: context.customerId,
          executionStage: stage,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) created += 1;
    else updated += 1;
  }

  const stale = await calendarEvents.deleteMany({
    ...managedFilter,
    occurrenceDate: { $nin: workingDays },
  });
  const items = await calendarEvents
    .find(managedFilter)
    .sort({ occurrenceDate: 1, _id: 1 })
    .toArray();

  return {
    managed: true,
    created,
    updated,
    deleted: stale.deletedCount,
    items,
  };
}
