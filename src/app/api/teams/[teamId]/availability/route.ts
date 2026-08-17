import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { mongoIdToString, readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildIdVariants, getCompanyMembersByIds, jsonResponse, noStoreHeaders } from "@/lib/tasks";
import { ensureExecutionTaskIndexes, getExecutionTasksCollection, hydrateExecutionTasks, normalizeExecutionTime } from "@/lib/executionTasks";
import { ensureTeamIndexes, getTeamsCollection, parseAvailabilityDate } from "@/lib/teams";
import {
  getEffectiveExecutionCrewUserIds,
  getExecutionBookingOverlapDetails,
  getExecutionUserBooking,
} from "@/lib/executionCrew";
import {
  buildAbsenceOverlapFilter,
  ensureAbsenceIndexes,
  getAbsenceBooking,
  getAbsencesCollection,
  isAbsenceFromTask,
} from "@/lib/absences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ teamId: string }> };

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);

  const { teamId } = await params;
  if (!ObjectId.isValid(teamId)) return jsonResponse(origin, { ok: false, error: "Invalid teamId" }, 400);
  const url = new URL(req.url);
  const start = parseAvailabilityDate(
    url.searchParams.get("start") ?? url.searchParams.get("from"),
  );
  const end = parseAvailabilityDate(
    url.searchParams.get("end") ?? url.searchParams.get("to"),
    true,
  );
  const startTimeParam = url.searchParams.get("startTime");
  const endTimeParam = url.searchParams.get("endTime");
  const startTime = startTimeParam == null ? null : normalizeExecutionTime(startTimeParam);
  const endTime = endTimeParam == null ? null : normalizeExecutionTime(endTimeParam);
  const excludeTaskId = safeString(url.searchParams.get("excludeTaskId"));
  if (!start || !end || start > end) {
    return jsonResponse(origin, { ok: false, error: "start and end must be valid YYYY-MM-DD dates" }, 400);
  }
  if (startTimeParam != null && startTime === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid startTime" }, 400);
  }
  if (endTimeParam != null && endTime === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid endTime" }, 400);
  }
  if (excludeTaskId && !ObjectId.isValid(excludeTaskId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid excludeTaskId" }, 400);
  }

  const companyId = String(session.activeCompanyId);
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureTeamIndexes(db), ensureExecutionTaskIndexes(db), ensureAbsenceIndexes(db)]);

    const team = await getTeamsCollection(db).findOne({
      _id: new ObjectId(teamId),
      companyId: { $in: buildIdVariants(companyId) },
    });
    if (!team) return jsonResponse(origin, { ok: false, error: "Team not found" }, 404);
    const excludedTask = excludeTaskId
      ? await getExecutionTasksCollection(db).findOne({
          _id: new ObjectId(excludeTaskId),
          companyId: { $in: buildIdVariants(companyId) },
        })
      : null;

    const memberIds = Array.from<string>(
      new Set<string>(
        (Array.isArray((team as any).members) ? (team as any).members : [])
          .map((member: any) => mongoIdToString(member?.userId))
          .filter(Boolean) as string[],
      ),
    );
    if (!memberIds.length) return jsonResponse(origin, { ok: true, conflicts: [] }, 200);

    const assignmentVariants = memberIds.flatMap((userId) => buildIdVariants(userId));
    const filter: Record<string, any> = {
      companyId: { $in: buildIdVariants(companyId) },
      scheduledStart: { $ne: null, $lte: end },
      $and: [
        {
          $or: [
            { assignedUserIds: { $in: assignmentVariants } },
            { "teamOverrides.inUserId": { $in: assignmentVariants } },
            { "extraAssignments.userId": { $in: assignmentVariants } },
          ],
        },
        {
          $or: [
            { scheduledEnd: { $gte: start } },
            { scheduledEnd: null, scheduledStart: { $gte: start } },
            { scheduledEnd: { $exists: false }, scheduledStart: { $gte: start } },
          ],
        },
      ],
    };
    if (excludeTaskId) filter._id = { $ne: new ObjectId(excludeTaskId) };

    const requestedStartDate = start.toISOString().slice(0, 10);
    const requestedEndDate = end.toISOString().slice(0, 10);
    const absenceFilter = {
      companyId: { $in: buildIdVariants(companyId) },
      userId: { $in: assignmentVariants },
      ...buildAbsenceOverlapFilter(requestedStartDate, requestedEndDate),
    };
    const [candidates, absences] = await Promise.all([
      getExecutionTasksCollection(db).find(filter).toArray(),
      getAbsencesCollection(db).find(absenceFilter).toArray(),
    ]);
    const [hydrated, users] = await Promise.all([
      hydrateExecutionTasks(db, companyId, candidates),
      getCompanyMembersByIds(db, companyId, memberIds),
    ]);
    const usersById = new Map(
      users.map((user: any) => [
        mongoIdToString(user?._id),
        [safeString(user?.firstName), safeString(user?.lastName)].filter(Boolean).join(" ") ||
          safeString(user?.name) ||
          safeString(user?.email),
      ]),
    );

    const requestedBookings = new Map(memberIds.map((userId) => [
      userId,
      getExecutionUserBooking({
        scheduledStart: start,
        scheduledEnd: end,
        startTime: startTime ?? null,
        endTime: endTime ?? null,
        excludedWeekdays: (excludedTask as any)?.excludedWeekdays,
        assignedUserIds: [userId],
      }, userId),
    ]));
    const taskConflicts = candidates.flatMap((task: any, index) => {
      const item = hydrated[index] as any;
      const assignedIds = new Set(getEffectiveExecutionCrewUserIds(task));
      return memberIds
        .filter((userId) => assignedIds.has(userId))
        .flatMap((userId) => {
          const requestedBooking = requestedBookings.get(userId) ?? null;
          const taskBooking = getExecutionUserBooking(task, userId);
          const overlaps = getExecutionBookingOverlapDetails(requestedBooking, taskBooking);
          const taskId = mongoIdToString(task?._id);
          const taskTitle =
            item?.planningTitle ||
            item?.customerName ||
            item?.projectNumber ||
            `${safeString(task?.track) || "Auftrag"} ${taskId}`;
          return overlaps.map((overlap) => ({
            type: "double_booking" as const,
            userId,
            fullName: usersById.get(userId) || "",
            taskId,
            taskTitle,
            day: overlap.day,
            startTime: overlap.startTime,
            endTime: overlap.endTime,
            scheduledStart:
              task?.scheduledStart instanceof Date
                ? task.scheduledStart.toISOString()
                : safeString(task?.scheduledStart),
            scheduledEnd:
              task?.scheduledEnd instanceof Date
                ? task.scheduledEnd.toISOString()
                : safeString(task?.scheduledEnd),
            days: [overlap.day],
          }));
        });
    });

    const absenceConflicts = absences.flatMap((absence: any) => {
      if (isAbsenceFromTask(absence, excludeTaskId)) return [];
      const userId = mongoIdToString(absence?.userId);
      if (!memberIds.includes(userId)) return [];
      const absenceBooking = getAbsenceBooking(absence);
      const overlaps = getExecutionBookingOverlapDetails(
        requestedBookings.get(userId) ?? null,
        absenceBooking,
      );
      return overlaps.map((overlap) => ({
        type: "absence" as const,
        userId,
        fullName: usersById.get(userId) || "",
        taskId: mongoIdToString(absence?.sourceTaskId) || null,
        taskTitle: "",
        reason: safeString(absence?.reason).toLowerCase(),
        startDate: safeString(absence?.startDate),
        endDate: safeString(absence?.endDate),
        day: overlap.day,
        startTime: overlap.startTime,
        endTime: overlap.endTime,
        days: [overlap.day],
      }));
    });

    return jsonResponse(origin, { ok: true, conflicts: [...taskConflicts, ...absenceConflicts] }, 200);
  } catch (error: any) {
    console.error("GET TEAM AVAILABILITY ERROR:", error);
    return jsonResponse(origin, { ok: false, error: error?.message || "Unknown error" }, 500);
  }
}
