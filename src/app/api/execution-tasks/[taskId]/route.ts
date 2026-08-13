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
  buildExtraAssignmentDayWindowHistoryTexts,
  deriveExecutionCrewUserIds,
  ExecutionCrewRequestError,
  findExecutionCrewConflicts,
  normalizeAndValidateAdditionalCrew,
  normalizeStoredAdditionalTeamIds,
  normalizeStoredExtraAssignments,
} from "@/lib/executionCrew";

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

    const updateSet: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (body?.notes !== undefined) {
      updateSet.notes = safeString(body?.notes);
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

    const actor = await resolveExecutionActorMeta(db, session);
    const existingTeamId =
      (existing as any)?.teamId instanceof ObjectId
        ? (existing as any).teamId.toString()
        : safeString((existing as any)?.teamId) || null;
    const teamHistoryEntries: Record<string, any>[] = [];
    const hasTeamInput = body?.teamId !== undefined || body?.teamOverrides !== undefined;
    const hasAdditionalCrewInput =
      body?.additionalTeamIds !== undefined || body?.extraAssignments !== undefined;
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

    const scheduleChanged = hasExecutionScheduleChanged(existing, {
      scheduledStart,
      scheduledEnd,
      startTime,
      endTime,
    });
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
        extraAssignments:
          body?.extraAssignments !== undefined ? body.extraAssignments : existingExtraAssignments,
        scheduledStart: finalScheduledStart,
        scheduledEnd: finalScheduledEnd,
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

    const scheduleHistoryEntries = [
      ...(scheduleHistoryEntry ? [scheduleHistoryEntry] : []),
      ...teamHistoryEntries,
    ];
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
      return jsonResponse(origin, { ok: false, error: e.message, message: e.message, code: e.code }, e.status);
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
