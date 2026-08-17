import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  jsonResponse,
  noStoreHeaders,
  getSessionUserId,
} from "@/lib/tasks";
import { readSession, safeString } from "@/lib/api-session";
import { buildIdVariants } from "@/lib/tasks";
import {
  buildExecutionScheduleHistoryEntry,
  ensureExecutionTaskIndexes,
  getExecutionTasksCollection,
  hasExecutionScheduleChanged,
  hydrateExecutionTasks,
  normalizeExecutionAddress,
  normalizeExecutionDate,
  normalizeExecutionStage,
  normalizeExecutionTime,
  resolveExecutionActorMeta,
  validateExecutionAssignees,
} from "@/lib/executionTasks";
import {
  deriveAssignedUserIds,
  ensureTeamIndexes,
  getTeamsCollection,
  normalizeAndValidateTeamOverrides,
  normalizeStoredTeamOverrides,
  TeamRequestError,
} from "@/lib/teams";
import {
  applyCrewDeviationReplacements,
  buildExtraAssignmentDayWindowHistoryTexts,
  deriveExecutionCrewUserIds,
  ExecutionCrewRequestError,
  findExecutionCrewConflicts,
  getEffectiveExecutionCrewUserIds,
  getExecutionCrewMutationLockIds,
  normalizeAndValidateCrewDeviations,
  normalizeAndValidateAdditionalCrew,
  normalizeStoredAdditionalTeamIds,
  normalizeStoredCrewDeviations,
  normalizeStoredExtraAssignments,
  pruneExecutionCrewForWorkingDays,
  withExecutionCrewMutationLocks,
} from "@/lib/executionCrew";
import { syncCrewDeviationAbsences } from "@/lib/absences";
import {
  ExecutionWorkingDaysError,
  resolveExecutionWorkingDayFields,
} from "@/lib/executionWorkingDays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ taskId: string }> };

function buildExecutionCompanyFilter(companyId: string) {
  return { companyId: { $in: buildIdVariants(companyId) } };
}

async function getScopedExecutionTask(
  db: Awaited<ReturnType<typeof getDb>>,
  companyId: string,
  taskId: string,
) {
  return getExecutionTasksCollection(db).findOne({
    _id: new ObjectId(taskId),
    ...buildExecutionCompanyFilter(companyId),
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureExecutionTaskIndexes(db), ensureTeamIndexes(db)]);

    const doc = await getScopedExecutionTask(db, String(session.activeCompanyId), taskId);
    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found" }, 404);
    }

    const [item] = await hydrateExecutionTasks(db, String(session.activeCompanyId), [doc]);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("GET EXECUTION TASK ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { taskId } = await params;
  if (!ObjectId.isValid(taskId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid taskId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const force = body?.force === true;
  const companyId = String(session.activeCompanyId);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await Promise.all([ensureExecutionTaskIndexes(db), ensureTeamIndexes(db)]);

    const existing = await getScopedExecutionTask(db, companyId, taskId);
    if (!existing) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found" }, 404);
    }

    const nextStage =
      body?.stage === undefined ? null : normalizeExecutionStage(body?.stage);
    if (body?.stage !== undefined && !nextStage) {
      return jsonResponse(origin, { ok: false, error: "Invalid stage" }, 400);
    }

    const scheduledStart =
      body?.scheduledStart === undefined
        ? undefined
        : normalizeExecutionDate(body?.scheduledStart);
    const scheduledEnd =
      body?.scheduledEnd === undefined
        ? undefined
        : normalizeExecutionDate(body?.scheduledEnd);
    const startTime =
      body?.startTime === undefined ? undefined : normalizeExecutionTime(body?.startTime);
    const endTime =
      body?.endTime === undefined ? undefined : normalizeExecutionTime(body?.endTime);

    if (body?.scheduledStart !== undefined && scheduledStart === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid scheduledStart" }, 400);
    }
    if (body?.scheduledEnd !== undefined && scheduledEnd === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid scheduledEnd" }, 400);
    }
    if (body?.startTime !== undefined && startTime === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid startTime" }, 400);
    }
    if (body?.endTime !== undefined && endTime === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid endTime" }, 400);
    }

    const finalScheduledStart =
      scheduledStart !== undefined ? scheduledStart : (existing as any)?.scheduledStart ?? null;
    const finalScheduledEnd =
      scheduledEnd !== undefined
        ? scheduledEnd
        : (existing as any)?.scheduledEnd ?? finalScheduledStart;
    const existingWorkingDayFields = resolveExecutionWorkingDayFields({
      scheduledStart: (existing as any)?.scheduledStart,
      scheduledEnd: (existing as any)?.scheduledEnd,
      excludedWeekdays: Object.prototype.hasOwnProperty.call(existing as any, "excludedWeekdays")
        ? (existing as any).excludedWeekdays
        : [],
      validateProvided: false,
    });
    const workingDayFields = resolveExecutionWorkingDayFields({
      scheduledStart: finalScheduledStart,
      scheduledEnd: finalScheduledEnd,
      excludedWeekdays:
        body?.excludedWeekdays !== undefined
          ? body.excludedWeekdays
          : Object.prototype.hasOwnProperty.call(existing as any, "excludedWeekdays")
            ? (existing as any).excludedWeekdays
            : [],
      workingDays: body?.workingDays,
    });
    const workingDaysChanged =
      JSON.stringify(existingWorkingDayFields) !== JSON.stringify(workingDayFields);

    const updateSet: Record<string, any> = {
      updatedAt: new Date(),
      excludedWeekdays: workingDayFields.excludedWeekdays,
      workingDays: workingDayFields.workingDays,
    };

    if (body?.notes !== undefined) {
      updateSet.notes = safeString(body?.notes);
    }
    if (body?.rescheduleReason !== undefined) {
      updateSet.rescheduleReason = safeString(body?.rescheduleReason).slice(0, 1000);
    }
    if (body?.address !== undefined) {
      updateSet.address = normalizeExecutionAddress({
        ...(existing as any)?.address,
        ...(body?.address ?? {}),
      });
    }
    if (scheduledStart !== undefined) {
      updateSet.scheduledStart = scheduledStart;
    }
    if (scheduledEnd !== undefined) {
      updateSet.scheduledEnd = scheduledEnd;
    }
    if (startTime !== undefined) {
      updateSet.startTime = startTime;
    }
    if (endTime !== undefined) {
      updateSet.endTime = endTime;
    }

    const scheduleChanged =
      hasExecutionScheduleChanged(existing, {
        scheduledStart,
        scheduledEnd,
        startTime,
        endTime,
      }) || workingDaysChanged;
    const actor = await resolveExecutionActorMeta(db, session);
    if (body?.changedByName !== undefined || body?.changedByUserId !== undefined) {
      updateSet.changedByName = actor.name;
      updateSet.changedByUserId = ObjectId.isValid(actor.id || "")
        ? new ObjectId(actor.id!)
        : actor.id;
    }
    const existingCrewDeviations = normalizeStoredCrewDeviations((existing as any)?.crewDeviations);
    const prunedCrew = scheduleChanged
      ? pruneExecutionCrewForWorkingDays({
          crewDeviations:
            body?.crewDeviations !== undefined ? body.crewDeviations : existingCrewDeviations,
          extraAssignments:
            body?.extraAssignments !== undefined
              ? body.extraAssignments
              : (existing as any)?.extraAssignments ?? [],
          workingDays: workingDayFields.workingDays,
        })
      : null;
    const finalScheduledStartForDeviations =
      scheduledStart !== undefined ? scheduledStart : (existing as any)?.scheduledStart ?? null;
    const finalScheduledEndForDeviations =
      scheduledEnd !== undefined
        ? scheduledEnd
        : (existing as any)?.scheduledEnd ?? finalScheduledStartForDeviations;
    let finalCrewDeviations = existingCrewDeviations;
    if (body?.crewDeviations !== undefined || (scheduleChanged && existingCrewDeviations.length > 0)) {
      const normalizedDeviations = await normalizeAndValidateCrewDeviations({
        db,
        companyId,
        input: prunedCrew?.crewDeviations ?? (
          body?.crewDeviations !== undefined ? body.crewDeviations : existingCrewDeviations
        ),
        scheduledStart: finalScheduledStartForDeviations,
        scheduledEnd: finalScheduledEndForDeviations,
        workingDays: workingDayFields.workingDays,
        taskStartTime: startTime !== undefined ? startTime : (existing as any)?.startTime ?? null,
        taskEndTime: endTime !== undefined ? endTime : (existing as any)?.endTime ?? null,
        extraAssignments:
          prunedCrew?.extraAssignments ?? (body?.extraAssignments !== undefined
            ? body.extraAssignments
            : (existing as any)?.extraAssignments ?? []),
        actorName: actor.name,
      });
      finalCrewDeviations = normalizedDeviations.crewDeviations;
      updateSet.crewDeviations = finalCrewDeviations;
    }
    const existingTeamId =
      (existing as any)?.teamId instanceof ObjectId
        ? (existing as any).teamId.toString()
        : safeString((existing as any)?.teamId) || null;
    const teamHistoryEntries: Record<string, any>[] = [];
    const hasTeamInput = body?.teamId !== undefined || body?.teamOverrides !== undefined;
    const hasAdditionalCrewInput =
      body?.additionalTeamIds !== undefined ||
      body?.extraAssignments !== undefined ||
      body?.crewDeviations !== undefined;
    const hasStructuredCrewInput = hasTeamInput || hasAdditionalCrewInput;
    const isLegacyDirectAssignment =
      body?.assignedUserIds !== undefined && !hasStructuredCrewInput;

    if (isLegacyDirectAssignment) {
      const { assignedUserIds } = await validateExecutionAssignees(
        db,
        companyId,
        (existing as any).track,
        body?.assignedUserIds,
      );
      updateSet.assignedUserIds = assignedUserIds;
      updateSet.teamId = null;
      updateSet.teamOverrides = [];
      updateSet.additionalTeamIds = [];
      updateSet.extraAssignments = [];
      if (existingTeamId) {
        teamHistoryEntries.push({
          type: "team_changed",
          previousTeamId: new ObjectId(existingTeamId),
          teamId: null,
          changedAt: new Date(),
          changedByUserId: ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
          changedByName: actor.name,
          reason: "legacy_direct_assignment",
        });
      }
    } else if (hasTeamInput) {
      const selectedTeamId =
        body?.teamId === undefined
          ? existingTeamId
          : body?.teamId == null || safeString(body?.teamId) === ""
            ? null
            : safeString(body?.teamId);

      if (selectedTeamId && !ObjectId.isValid(selectedTeamId)) {
        throw new TeamRequestError("Ungültige Team-ID.", { code: "INVALID_TEAM_ID" });
      }

      if (!selectedTeamId) {
        if (body?.teamOverrides !== undefined && (!Array.isArray(body.teamOverrides) || body.teamOverrides.length)) {
          throw new TeamRequestError("Overrides benötigen ein aktives Team.", {
            code: "TEAM_REQUIRED_FOR_OVERRIDES",
          });
        }
        updateSet.teamId = null;
        updateSet.teamOverrides = [];
        if (body?.assignedUserIds !== undefined) {
          const { assignedUserIds } = await validateExecutionAssignees(
            db,
            companyId,
            (existing as any).track,
            body.assignedUserIds,
          );
          updateSet.assignedUserIds = assignedUserIds;
        } else {
          updateSet.assignedUserIds = [];
        }
      } else {
        const team = await getTeamsCollection(db).findOne({
          _id: new ObjectId(selectedTeamId),
          companyId: { $in: buildIdVariants(companyId) },
          status: "active",
          tracks: (existing as any).track,
        });
        if (!team) {
          throw new TeamRequestError(
            "Das Team ist nicht aktiv, gehört nicht zur Firma oder deckt den Auftragstyp nicht ab.",
            { code: "INVALID_TASK_TEAM" },
          );
        }
        const teamMemberIds = Array.from<string>(
          new Set<string>(
            (Array.isArray((team as any).members) ? (team as any).members : [])
              .map((member: any) =>
                member?.userId instanceof ObjectId
                  ? member.userId.toString()
                  : safeString(member?.userId),
              )
              .filter(Boolean) as string[],
          ),
        );
        const previousOverrides =
          selectedTeamId === existingTeamId
            ? Array.isArray((existing as any)?.teamOverrides)
              ? (existing as any).teamOverrides
              : []
            : [];
        const incomingOverrides =
          body?.teamOverrides === undefined ? previousOverrides : body.teamOverrides;
        const normalizedIncoming = await normalizeAndValidateTeamOverrides({
          db,
          companyId,
          input: incomingOverrides,
          teamMemberIds,
          existing: previousOverrides,
          actorUserId: actor.id,
        });

        const previousNormalized = normalizeStoredTeamOverrides(previousOverrides);
        const previousKeys = new Set(
          previousNormalized.map((override) => JSON.stringify(override)),
        );
        const mergedOverrides = [...previousOverrides];
        for (const override of normalizedIncoming) {
          const [normalized] = normalizeStoredTeamOverrides([override]);
          const key = JSON.stringify(normalized);
          if (!previousKeys.has(key)) {
            mergedOverrides.push(override);
            previousKeys.add(key);
            teamHistoryEntries.push({
              type: "member_replaced",
              outUserId: (override as any).outUserId,
              inUserId: (override as any).inUserId,
              reason: (override as any).reason,
              changedAt: new Date(),
              changedByUserId:
                ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
              changedByName: actor.name,
            });
          }
        }
        const assignedIds = deriveAssignedUserIds(teamMemberIds, mergedOverrides);
        updateSet.teamId = new ObjectId(selectedTeamId);
        updateSet.teamOverrides = mergedOverrides;
        updateSet.assignedUserIds = assignedIds.map((userId) => new ObjectId(userId));
      }

      if (selectedTeamId !== existingTeamId) {
        teamHistoryEntries.unshift({
          type: "team_changed",
          previousTeamId: existingTeamId ? new ObjectId(existingTeamId) : null,
          teamId: selectedTeamId ? new ObjectId(selectedTeamId) : null,
          changedAt: new Date(),
          changedByUserId: ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
          changedByName: actor.name,
          reason: null,
        });
      }
    }

    const existingAdditionalTeamIds = normalizeStoredAdditionalTeamIds((existing as any)?.additionalTeamIds);
    const existingExtraAssignments = normalizeStoredExtraAssignments((existing as any)?.extraAssignments);
    const shouldResolveStructuredCrew =
      !isLegacyDirectAssignment &&
      (hasStructuredCrewInput ||
        (scheduleChanged && (existingAdditionalTeamIds.length > 0 || existingExtraAssignments.length > 0)));

    if (shouldResolveStructuredCrew) {
      const finalMainTeamValue = updateSet.teamId !== undefined ? updateSet.teamId : (existing as any)?.teamId;
      const finalMainTeamId =
        finalMainTeamValue instanceof ObjectId
          ? finalMainTeamValue.toString()
          : safeString(finalMainTeamValue) || null;
      const finalTeamOverrides =
        updateSet.teamOverrides !== undefined ? updateSet.teamOverrides : (existing as any)?.teamOverrides ?? [];
      const finalScheduledStart =
        scheduledStart !== undefined ? scheduledStart : (existing as any)?.scheduledStart ?? null;
      const finalScheduledEnd =
        scheduledEnd !== undefined ? scheduledEnd : (existing as any)?.scheduledEnd ?? finalScheduledStart;

      const mainTeam = finalMainTeamId
        ? await getTeamsCollection(db).findOne({
            _id: new ObjectId(finalMainTeamId),
            companyId: { $in: buildIdVariants(companyId) },
          })
        : null;
      if (finalMainTeamId && !mainTeam) {
        throw new ExecutionCrewRequestError("Das Haupt-Team gehört nicht zur Firma oder existiert nicht.", "INVALID_TASK_TEAM");
      }
      const mainTeamMemberIds = Array.from(new Set(
        Array.isArray((mainTeam as any)?.members)
          ? (mainTeam as any).members
              .map((member: any) => member?.userId instanceof ObjectId
                ? member.userId.toString()
                : safeString(member?.userId))
              .filter(Boolean)
          : [],
      )) as string[];

      const additionalCrew = await normalizeAndValidateAdditionalCrew({
        db,
        companyId,
        mainTeamId: finalMainTeamId,
        additionalTeamIds:
          body?.additionalTeamIds !== undefined ? body.additionalTeamIds : existingAdditionalTeamIds,
        extraAssignments: applyCrewDeviationReplacements(
          prunedCrew?.extraAssignments ?? (
            body?.extraAssignments !== undefined ? body.extraAssignments : existingExtraAssignments
          ),
          finalCrewDeviations,
          (existing as any)?.track === "elektro" ? "elektriker" : "monteur",
          existingExtraAssignments
            .filter((assignment) => Array.isArray(assignment.replacementForDeviationIds))
            .map((assignment) => assignment.userId),
          {
            scheduledStart: finalScheduledStart,
            scheduledEnd: finalScheduledEnd,
            taskStartTime: startTime !== undefined ? startTime : (existing as any)?.startTime ?? null,
            taskEndTime: endTime !== undefined ? endTime : (existing as any)?.endTime ?? null,
            sourceAssignments:
              prunedCrew?.extraAssignments ?? (
                body?.extraAssignments !== undefined ? body.extraAssignments : existingExtraAssignments
              ),
          },
        ),
        scheduledStart: finalScheduledStart,
        scheduledEnd: finalScheduledEnd,
        workingDays: workingDayFields.workingDays,
      });

      let directBaseUserIds: string[] = [];
      if (!finalMainTeamId && !existingTeamId) {
        const previousAdditionalTeams = existingAdditionalTeamIds.length
          ? await getTeamsCollection(db).find({
              _id: { $in: existingAdditionalTeamIds.map((id) => new ObjectId(id)) },
              companyId: { $in: buildIdVariants(companyId) },
            }).toArray()
          : [];
        const previousStructuredUsers = new Set([
          ...previousAdditionalTeams.flatMap((team: any) =>
            Array.isArray(team?.members)
              ? team.members.map((member: any) =>
                  member?.userId instanceof ObjectId ? member.userId.toString() : safeString(member?.userId),
                ).filter(Boolean)
              : [],
          ),
          ...existingExtraAssignments.map((assignment) => assignment.userId),
        ]);
        directBaseUserIds = (Array.isArray((existing as any)?.assignedUserIds)
          ? (existing as any).assignedUserIds.map((value: any) =>
              value instanceof ObjectId ? value.toString() : safeString(value),
            ).filter(Boolean)
          : []).filter((userId: string) => !previousStructuredUsers.has(userId));
      }

      const assignedIds = Array.from(new Set([
        ...directBaseUserIds,
        ...deriveExecutionCrewUserIds({
          mainTeamMemberIds,
          teamOverrides: finalTeamOverrides,
          additionalTeamMemberIds: additionalCrew.additionalTeamMemberIds,
          extraAssignments: additionalCrew.extraAssignments,
        }),
      ]));
      updateSet.additionalTeamIds = additionalCrew.additionalTeamIds;
      updateSet.extraAssignments = additionalCrew.extraAssignments;
      updateSet.assignedUserIds = assignedIds.map((userId) => new ObjectId(userId));

      const now = new Date();
      const historyBase = {
        changedAt: now,
        changedByUserId: ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
        changedByName: actor.name,
      };
      const oldTeamSet = new Set(existingAdditionalTeamIds);
      const newTeamSet = new Set(additionalCrew.additionalTeamIds);
      const teamNameById = new Map(additionalCrew.teams.map((team: any) => [
        team._id.toString(),
        safeString(team?.name) || team._id.toString(),
      ]));
      for (const teamId of newTeamSet) {
        if (!oldTeamSet.has(teamId)) {
          const text = `Zusatzteam ${teamNameById.get(teamId) || teamId} hinzugefügt`;
          teamHistoryEntries.push({ ...historyBase, type: "additional_team_changed", action: "added", additionalTeamId: new ObjectId(teamId), text, reason: text });
        }
      }
      for (const teamId of oldTeamSet) {
        if (!newTeamSet.has(teamId)) {
          const text = `Zusatzteam ${teamId} entfernt`;
          teamHistoryEntries.push({ ...historyBase, type: "additional_team_changed", action: "removed", additionalTeamId: new ObjectId(teamId), text, reason: text });
        }
      }

      const userNameById = new Map(additionalCrew.users.map((user: any) => [
        user._id.toString(),
        [safeString(user?.firstName), safeString(user?.lastName)].filter(Boolean).join(" ") ||
          safeString(user?.name) || safeString(user?.email) || user._id.toString(),
      ]));
      const oldExtraByUser = new Map(existingExtraAssignments.map((assignment) => [assignment.userId, assignment]));
      const newExtra = normalizeStoredExtraAssignments(additionalCrew.extraAssignments);
      const newExtraByUser = new Map(newExtra.map((assignment) => [assignment.userId, assignment]));
      for (const [userId, assignment] of newExtraByUser) {
        const previous = oldExtraByUser.get(userId);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(assignment)) {
          const userName = userNameById.get(userId) || userId;
          const dayWindowTexts = buildExtraAssignmentDayWindowHistoryTexts(
            previous ?? null,
            assignment,
            userName,
          );
          for (const text of dayWindowTexts) {
            teamHistoryEntries.push({
              ...historyBase,
              type: "extra_assignment_changed",
              action: "day_window_updated",
              userId: new ObjectId(userId),
              text,
              reason: text,
            });
          }
          const previousByDay = new Map((previous?.dayWindows ?? []).map((window) => [window.day, window]));
          const nextByDay = new Map((assignment.dayWindows ?? []).map((window) => [window.day, window]));
          for (const day of Array.from(new Set([...previousByDay.keys(), ...nextByDay.keys()])).sort()) {
            const before = previousByDay.get(day) ?? null;
            const after = nextByDay.get(day) ?? null;
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            teamHistoryEntries.push({
              ...historyBase,
              type: "day_updated",
              action: "day_window_updated",
              userId: new ObjectId(userId),
              day,
              before,
              after,
              actorName: actor.name,
              text: `Einsatztag ${day} geändert`,
              reason: "day_updated",
            });
          }
          const dayText = assignment.days?.length
            ? assignment.days.map((day) => day.split("-").reverse().join(".")).join(", ")
            : "gesamten Termin";
          const timeText = assignment.dayWindows?.length
            ? " mit individuellen Tagesfenstern"
            : assignment.startTime && assignment.endTime
              ? ` ${assignment.startTime}–${assignment.endTime}`
              : " ganztags";
          const action = previous ? "updated" : "added";
          const text = `Zusatzkraft ${userName} am ${dayText}${timeText} ${previous ? "geändert" : "hinzugefügt"}`;
          teamHistoryEntries.push({ ...historyBase, type: "extra_assignment_changed", action, userId: new ObjectId(userId), text, reason: text });
        }
      }
      for (const userId of oldExtraByUser.keys()) {
        if (!newExtraByUser.has(userId)) {
          const text = `Zusatzkraft ${userId} entfernt`;
          teamHistoryEntries.push({ ...historyBase, type: "extra_assignment_changed", action: "removed", userId: new ObjectId(userId), text, reason: text });
        }
      }
    }

    if (body?.crewDeviations !== undefined) {
      const historyBase = {
        changedAt: new Date(),
        changedByUserId: ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
        changedByName: actor.name,
      };
      const previousByKey = new Map(existingCrewDeviations.map((deviation) => [
        `${deviation.userId}:${deviation.id}`,
        deviation,
      ]));
      const nextByKey = new Map(finalCrewDeviations.map((deviation) => [
        `${deviation.userId}:${deviation.id}`,
        deviation,
      ]));
      for (const [key, deviation] of nextByKey) {
        const previous = previousByKey.get(key);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(deviation)) {
          const text = `${deviation.type}: ${deviation.days.join(", ")}`;
          teamHistoryEntries.push({
            ...historyBase,
            type: previous ? "day_updated" : "deviation_added",
            action: previous ? "updated" : "added",
            deviationId: deviation.id,
            userId: new ObjectId(deviation.userId),
            deviationType: deviation.type,
            days: deviation.days,
            replacementUserId: deviation.replacementUserId
              ? new ObjectId(deviation.replacementUserId)
              : null,
            actorName: deviation.actorName,
            day: deviation.days[0],
            before: previous ?? null,
            after: deviation,
            text,
            reason: text,
          });
          if (deviation.replacementUserId !== previous?.replacementUserId && deviation.replacementUserId) {
            teamHistoryEntries.push({
              ...historyBase,
              type: "replacement_assigned",
              action: "assigned",
              deviationId: deviation.id,
              userId: new ObjectId(deviation.userId),
              deviationType: deviation.type,
              days: deviation.days,
              replacementUserId: new ObjectId(deviation.replacementUserId),
              actorName: deviation.actorName,
              day: deviation.days[0],
              before: previous?.replacementUserId ?? null,
              after: deviation.replacementUserId,
              text: `Ersatz für ${deviation.userId}: ${deviation.replacementUserId}`,
              reason: "replacement_assigned",
            });
          }
        }
      }
      for (const [key, deviation] of previousByKey) {
        if (!nextByKey.has(key)) {
          teamHistoryEntries.push({
            ...historyBase,
            type: "deviation_removed",
            action: "removed",
            deviationId: deviation.id,
            userId: new ObjectId(deviation.userId),
            deviationType: deviation.type,
            days: deviation.days,
            replacementUserId: deviation.replacementUserId
              ? new ObjectId(deviation.replacementUserId)
              : null,
            actorName: actor.name,
            day: deviation.days[0],
            before: deviation,
            after: null,
            text: `${deviation.type} entfernt`,
            reason: "deviation_removed",
          });
        }
      }
    }

    const scheduleHistoryEntry = scheduleChanged
      ? buildExecutionScheduleHistoryEntry(existing, actor, body?.rescheduleReason)
      : null;

    let pushStageHistory: Record<string, any> | null = null;
    if (nextStage && nextStage !== (existing as any)?.stage) {
      updateSet.stage = nextStage;
      pushStageHistory = {
        stage: nextStage,
        at: new Date().toISOString(),
        by: getSessionUserId(session) || null,
      };
    }

    updateSet.assignedUserIds = getEffectiveExecutionCrewUserIds({
      ...(existing as any),
      ...updateSet,
    })
      .filter((userId) => ObjectId.isValid(userId))
      .map((userId) => new ObjectId(userId));

    if (updateSet.assignedUserIds !== undefined) {
      const previousAssigned = new Set<string>(
        Array.isArray((existing as any)?.assignedUserIds)
          ? (existing as any).assignedUserIds
              .map((value: any) => value instanceof ObjectId ? value.toString() : safeString(value))
              .filter(Boolean)
          : [],
      );
      const nextAssigned = new Set<string>(
        Array.isArray(updateSet.assignedUserIds)
          ? updateSet.assignedUserIds
              .map((value: any) => value instanceof ObjectId ? value.toString() : safeString(value))
              .filter(Boolean)
          : [],
      );
      for (const removedUserId of previousAssigned) {
        if (nextAssigned.has(removedUserId)) continue;
        teamHistoryEntries.push({
          type: "member_removed",
          changedAt: new Date(),
          changedByUserId: ObjectId.isValid(actor.id || "") ? new ObjectId(actor.id!) : actor.id,
          changedByName: actor.name,
          actorName: actor.name,
          userId: new ObjectId(removedUserId),
          action: "removed",
          before: { assigned: true },
          after: { assigned: false },
          text: `Mitarbeiter ${removedUserId} aus Auftrag entfernt`,
          reason: "member_removed",
        });
      }
    }

    const scheduleHistoryEntries = [
      ...(scheduleHistoryEntry ? [scheduleHistoryEntry] : []),
      ...teamHistoryEntries,
    ];
    const candidateTask = { ...(existing as any), ...updateSet, _id: new ObjectId(taskId) };
    const candidateAssignedUserIds = new Set(
      Array.isArray(candidateTask.assignedUserIds)
        ? candidateTask.assignedUserIds
            .map((value: any) => value instanceof ObjectId ? value.toString() : safeString(value))
            .filter(Boolean)
        : [],
    );
    const unassignedDeviation = normalizeStoredCrewDeviations(candidateTask.crewDeviations)
      .find((deviation) => !candidateAssignedUserIds.has(deviation.userId));
    if (unassignedDeviation) {
      throw new ExecutionCrewRequestError(
        "Eine Abweichung darf nur für einen dem Auftrag zugewiesenen Mitarbeiter erfasst werden.",
        "DEVIATION_USER_NOT_ASSIGNED",
      );
    }
    const mustValidateCrewMutation = scheduleChanged || hasStructuredCrewInput || isLegacyDirectAssignment;
    const lockIds = getExecutionCrewMutationLockIds(companyId, [existing, candidateTask]);
    await withExecutionCrewMutationLocks({
      db,
      lockIds,
      run: async () => {
        if (mustValidateCrewMutation) {
          const blockingConflicts = await findExecutionCrewConflicts({
            db,
            companyId,
            task: candidateTask,
          });
          if (blockingConflicts.length && !force) {
            const conflictError = new ExecutionCrewRequestError(
              "Mindestens ein Mitarbeiter ist im gewählten Zeitfenster nicht verfügbar.",
              "CREW_CONFLICT",
              409,
            );
            (conflictError as any).conflicts = blockingConflicts;
            throw conflictError;
          }
        }
        await getExecutionTasksCollection(db).updateOne(
          { _id: new ObjectId(taskId), ...buildExecutionCompanyFilter(companyId) },
          {
            $set: updateSet,
            ...((pushStageHistory || scheduleHistoryEntries.length)
              ? {
                  $push: {
                    ...(pushStageHistory ? { stageHistory: pushStageHistory } : {}),
                    ...(scheduleHistoryEntries.length
                      ? { scheduleHistory: { $each: scheduleHistoryEntries } }
                      : {}),
                  },
                }
              : {}),
          } as any,
        );
        await syncCrewDeviationAbsences({
          db,
          companyId,
          taskId,
          crewDeviations: normalizeStoredCrewDeviations(candidateTask.crewDeviations),
          actorUserId: actor.id,
        });
      },
    });

    const updated = await getScopedExecutionTask(db, companyId, taskId);
    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Execution task not found after update" }, 404);
    }

    const [item] = await hydrateExecutionTasks(db, companyId, [updated]);
    const validate = new URL(req.url).searchParams.get("validate") === "1";
    const conflicts = validate ? await findExecutionCrewConflicts({ db, companyId, task: updated }) : null;
    return jsonResponse(origin, { ok: true, item, ...(validate ? { conflicts } : {}) }, 200);
  } catch (e: any) {
    if (e instanceof ExecutionCrewRequestError) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error: e.message,
          message: e.message,
          code: e.code,
          ...((e as any).conflicts ? { conflicts: (e as any).conflicts } : {}),
        },
        e.status,
      );
    }
    if (e instanceof ExecutionWorkingDaysError) {
      return jsonResponse(
        origin,
        { ok: false, error: e.message, message: e.message, code: e.code },
        e.status,
      );
    }
    if (e instanceof TeamRequestError) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error: e.message,
          code: e.code,
          ...(e.conflictUserIds.length ? { conflictUserIds: e.conflictUserIds } : {}),
        },
        e.status,
      );
    }
    console.error("PATCH EXECUTION TASK ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}
