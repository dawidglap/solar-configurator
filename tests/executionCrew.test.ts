import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  applyCrewDeviationReplacements,
  buildExtraAssignmentDayWindowHistoryTexts,
  deriveExtraAssignmentDayWindows,
  ExecutionCrewRequestError,
  getExecutionBookingOverlap,
  findExecutionCrewConflicts,
  getEffectiveExecutionCrewUserIds,
  getExecutionCrewMutationLockIds,
  getExecutionUserBooking,
  getPlannedExecutionWindow,
  normalizeAndValidateAdditionalCrew,
  normalizeAndValidateCrewDeviations,
  normalizeStoredCrewDeviations,
  normalizeStoredExtraAssignments,
  withExecutionCrewMutationLocks,
} from "../src/lib/executionCrew";
import {
  normalizeExecutionScheduleHistory,
  normalizeExecutionTask,
} from "../src/lib/executionTasks";

const userId = new ObjectId().toString();

function conflictDb(args: {
  companyId: ObjectId;
  candidates?: any[];
  absences?: any[];
}) {
  const users = [{
    _id: new ObjectId(userId),
    firstName: "Marco",
    lastName: "Keller",
    status: "active",
    memberships: [{ companyId: args.companyId, status: "active" }],
  }];
  return {
    collection: (name: string) => {
      if (name === "executionTasks") {
        return { find: () => ({ toArray: async () => args.candidates ?? [] }) };
      }
      if (name === "absences") {
        return {
          createIndex: async () => "ok",
          find: () => ({ toArray: async () => args.absences ?? [] }),
        };
      }
      if (name === "users") return { find: () => ({ toArray: async () => users }) };
      if (name === "plannings") return { find: () => ({ toArray: async () => [] }) };
      throw new Error(`Unexpected collection ${name}`);
    },
  } as any;
}

function activeUsersDb(ids: string[], companyId: string) {
  return {
    collection: (name: string) => name === "users"
      ? {
          find: () => ({
            toArray: async () => ids.map((id) => ({
              _id: new ObjectId(id),
              status: "active",
              memberships: [{ companyId: new ObjectId(companyId), status: "active" }],
            })),
          }),
        }
      : { find: () => ({ toArray: async () => [] }) },
  } as any;
}

test("validates crew deviations with stable error codes", async () => {
  const companyId = new ObjectId().toString();
  const base = {
    db: activeUsersDb([userId], companyId),
    companyId,
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-28",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    actorName: "Max Müller",
  };
  const cases: Array<[any, string]> = [
    [{ id: "dev_1", userId, type: "homeoffice", days: ["2026-08-27"] }, "UNKNOWN_DEVIATION_TYPE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-29"] }, "DEVIATION_DAY_OUTSIDE_SCHEDULE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27", "2026-08-28"] }, "INVALID_DEVIATION_DAYS"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27"], startTime: "15:00", endTime: "10:00" }, "INVALID_DEVIATION_TIME_RANGE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27"], replacementUserId: userId }, "DEVIATION_REPLACEMENT_SAME_USER"],
  ];
  for (const [deviation, code] of cases) {
    await assert.rejects(
      normalizeAndValidateCrewDeviations({ ...base, input: [deviation] }),
      (error: any) => error instanceof ExecutionCrewRequestError && error.code === code,
    );
  }
  await assert.rejects(
    normalizeAndValidateCrewDeviations({
      ...base,
      input: [
        { id: "dev_1", userId, type: "krank", days: ["2026-08-27"] },
        { id: "dev_2", userId, type: "ferien", days: ["2026-08-27"] },
      ],
    }),
    (error: any) =>
      error instanceof ExecutionCrewRequestError &&
      error.code === "DUPLICATE_DAY_DEVIATION" &&
      error.status === 409,
  );
});

test("crew deviations round-trip and derive global from the stable type catalog", async () => {
  const companyId = new ObjectId().toString();
  const at = "2026-08-13T11:34:00.000Z";
  const result = await normalizeAndValidateCrewDeviations({
    db: activeUsersDb([userId], companyId),
    companyId,
    input: [{
      id: "dev_ab12cd",
      userId,
      type: "krank",
      days: ["2026-08-27"],
      startTime: "10:00",
      endTime: "15:00",
      global: false,
      note: "Arztzeug folgt",
      actorName: "Max Müller",
      at,
    }],
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-28",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    actorName: "Max Müller",
  });
  assert.deepEqual(normalizeStoredCrewDeviations(result.crewDeviations), result.crewDeviations);
  assert.equal(result.crewDeviations[0].global, true);

  const task = normalizeExecutionTask({
    _id: new ObjectId(),
    companyId: new ObjectId(companyId),
    track: "montage",
    crewDeviations: result.crewDeviations,
  });
  assert.deepEqual(task.crewDeviations, result.crewDeviations);
});

test("supports independent planned windows and three different late arrivals", async () => {
  const companyId = new ObjectId().toString();
  const extraAssignments = [{
    userId,
    role: "monteur",
    days: ["2026-08-25", "2026-08-26", "2026-08-27"],
    dayWindows: [
      { day: "2026-08-25", startTime: "07:00", endTime: "15:00" },
      { day: "2026-08-26", startTime: "07:00", endTime: "15:00" },
      { day: "2026-08-27", startTime: "07:00", endTime: "15:00" },
    ],
  }];
  const input = [
    { id: "dev_25", userId, type: "verspaetet", days: ["2026-08-25"], startTime: "07:00", endTime: "08:15" },
    { id: "dev_26", userId, type: "verspaetet", days: ["2026-08-26"], startTime: "07:00", endTime: "09:00" },
    { id: "dev_27", userId, type: "verspaetet", days: ["2026-08-27"], startTime: "07:00", endTime: "07:45" },
  ];
  const result = await normalizeAndValidateCrewDeviations({
    db: activeUsersDb([userId], companyId),
    companyId,
    input,
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-08-27",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    extraAssignments,
    actorName: "Dawid Beckham",
  });
  assert.deepEqual(result.crewDeviations.map((item) => item.endTime), ["08:15", "09:00", "07:45"]);
  assert.equal(result.crewDeviations.every((item) => item.global === false), true);
});

test("validates type-specific windows against each planned day", async () => {
  const companyId = new ObjectId().toString();
  const base = {
    db: activeUsersDb([userId], companyId),
    companyId,
    scheduledStart: "2026-08-25T00:00:00+02:00",
    scheduledEnd: "2026-08-25T23:00:00+02:00",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    actorName: "Dawid Beckham",
  };
  const invalid: Array<[any, string]> = [
    [{ id: "late", userId, type: "verspaetet", days: ["2026-08-25"], startTime: "08:00", endTime: "09:00" }, "INVALID_LATE_WINDOW"],
    [{ id: "early", userId, type: "frueher_weg", days: ["2026-08-25"], startTime: "12:30", endTime: "14:00" }, "INVALID_EARLY_LEAVE_WINDOW"],
    [{ id: "partial", userId, type: "teilweise_abwesend", days: ["2026-08-25"], startTime: "06:00", endTime: "08:00" }, "DEVIATION_OUTSIDE_PLANNED_WINDOW"],
    [{ id: "doctor", userId, type: "arzttermin", days: ["2026-08-25"], startTime: null, endTime: null }, "DEVIATION_TIME_REQUIRED"],
  ];
  for (const [deviation, code] of invalid) {
    await assert.rejects(
      normalizeAndValidateCrewDeviations({ ...base, input: [deviation] }),
      (error: any) => error instanceof ExecutionCrewRequestError && error.code === code,
    );
  }
  const valid = await normalizeAndValidateCrewDeviations({
    ...base,
    input: [{
      id: "early_valid",
      userId,
      type: "frueher_weg",
      days: ["2026-08-25"],
      startTime: "12:30",
      endTime: "15:00",
    }],
  });
  assert.equal(valid.crewDeviations[0].days[0], "2026-08-25");
});

test("missing assignment days are free and cannot receive a task deviation", async () => {
  const companyId = new ObjectId().toString();
  const extraAssignments = [{
    userId,
    role: "monteur",
    days: ["2026-08-25"],
    dayWindows: [{ day: "2026-08-25", startTime: "07:00", endTime: "15:00" }],
  }];
  assert.equal(getPlannedExecutionWindow({
    userId,
    day: "2026-08-26",
    extraAssignments,
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-08-26",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
  }), null);
  await assert.rejects(
    normalizeAndValidateCrewDeviations({
      db: activeUsersDb([userId], companyId),
      companyId,
      input: [{ id: "missing", userId, type: "krank", days: ["2026-08-26"] }],
      scheduledStart: "2026-08-25",
      scheduledEnd: "2026-08-26",
      taskStartTime: "07:00",
      taskEndTime: "15:00",
      extraAssignments,
      actorName: "Dawid Beckham",
    }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "DEVIATION_USER_NOT_ASSIGNED_ON_DAY",
  );
  const booking = getExecutionUserBooking({
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-08-26",
    assignedUserIds: [userId],
    extraAssignments,
  }, userId);
  assert.deepEqual(booking?.days, ["2026-08-25"]);
});

test("legacy multi-day deviations lazily split into independent days", () => {
  const normalized = normalizeStoredCrewDeviations([{
    id: "dev_legacy",
    userId,
    type: "ferien",
    days: ["2026-08-25", "2026-08-26"],
  }]);
  assert.deepEqual(normalized.map((item) => item.days), [["2026-08-25"], ["2026-08-26"]]);
  assert.deepEqual(normalized.map((item) => item.id), ["dev_legacy", "dev_legacy_20260826"]);
});

test("represents the complete per-day acceptance scenario without shared-day hacks", async () => {
  const companyId = new ObjectId().toString();
  const replacementUserId = new ObjectId().toString();
  const assignedDays = [
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-31",
    "2026-09-01",
  ];
  const dayWindows = assignedDays.map((day) => ({
    day,
    startTime: day === "2026-08-29" ? "08:00" : "07:00",
    endTime: day === "2026-08-29" ? "14:00" : "15:00",
  }));
  const sourceAssignments = [{
    userId,
    role: "leiter",
    days: assignedDays,
    dayWindows,
  }];
  const input = [
    { id: "d25", userId, type: "verspaetet", days: ["2026-08-25"], startTime: "07:00", endTime: "08:15" },
    { id: "d26", userId, type: "verspaetet", days: ["2026-08-26"], startTime: "07:00", endTime: "09:00" },
    { id: "d27", userId, type: "verspaetet", days: ["2026-08-27"], startTime: "07:00", endTime: "07:45" },
    { id: "d28", userId, type: "krank", days: ["2026-08-28"], startTime: null, endTime: null, replacementUserId },
    { id: "d31", userId, type: "teilweise_abwesend", days: ["2026-08-31"], startTime: "10:00", endTime: "12:00" },
    { id: "d01", userId, type: "frueher_weg", days: ["2026-09-01"], startTime: "12:30", endTime: "15:00" },
  ];
  const result = await normalizeAndValidateCrewDeviations({
    db: activeUsersDb([userId, replacementUserId], companyId),
    companyId,
    input,
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-09-01",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    extraAssignments: sourceAssignments,
    actorName: "Dawid Beckham",
  });
  assert.equal(result.crewDeviations.length, 6);
  assert.equal(result.crewDeviations.find((item) => item.id === "d28")?.global, true);
  const booking = getExecutionUserBooking({
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-09-01",
    assignedUserIds: [userId],
    extraAssignments: sourceAssignments,
    crewDeviations: result.crewDeviations,
  }, userId);
  assert.equal(booking?.days.includes("2026-08-30"), false);
  const replacements = applyCrewDeviationReplacements([], result.crewDeviations, "monteur", [], {
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-09-01",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    sourceAssignments,
  });
  assert.deepEqual(replacements[0].dayWindows, [
    { day: "2026-08-28", startTime: "07:00", endTime: "15:00" },
  ]);
});

test("deviation users and replacements are tenant-scoped", async () => {
  const companyId = new ObjectId().toString();
  await assert.rejects(
    normalizeAndValidateCrewDeviations({
      db: activeUsersDb([], companyId),
      companyId,
      input: [{ id: "tenant", userId, type: "krank", days: ["2026-08-25"] }],
      scheduledStart: "2026-08-25",
      scheduledEnd: "2026-08-25",
      taskStartTime: "07:00",
      taskEndTime: "15:00",
      actorName: "Dawid Beckham",
    }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "INVALID_DEVIATION_USER",
  );
});

test("deviation windows remove only the unavailable part from task conflicts", () => {
  const unavailableTask = getExecutionUserBooking({
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-27",
    startTime: "07:00",
    endTime: "17:00",
    assignedUserIds: [userId],
    crewDeviations: [{
      id: "dev_1",
      userId,
      type: "teilweise_abwesend",
      days: ["2026-08-27"],
      startTime: "10:00",
      endTime: "15:00",
    }],
  }, userId);
  const duringAbsence = getExecutionUserBooking({
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-27",
    startTime: "11:00",
    endTime: "14:00",
    assignedUserIds: [userId],
  }, userId);
  const beforeAbsence = getExecutionUserBooking({
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-27",
    startTime: "08:00",
    endTime: "09:00",
    assignedUserIds: [userId],
  }, userId);
  assert.deepEqual(getExecutionBookingOverlap(duringAbsence, unavailableTask), []);
  assert.deepEqual(getExecutionBookingOverlap(beforeAbsence, unavailableTask), ["2026-08-27"]);
});

test("full-day sickness creates no self-conflict and only an absence on another task", async () => {
  const companyId = new ObjectId();
  const taskAId = new ObjectId();
  const taskBId = new ObjectId();
  const deviation = {
    id: "dev_sick",
    userId,
    type: "krank",
    days: ["2026-08-18"],
    startTime: null,
    endTime: null,
    global: true,
  };
  const taskA = {
    _id: taskAId,
    companyId,
    scheduledStart: "2026-08-18",
    scheduledEnd: "2026-08-18",
    startTime: "07:00",
    endTime: "15:00",
    assignedUserIds: [new ObjectId(userId)],
    crewDeviations: [deviation],
  };
  const absence = {
    _id: new ObjectId(),
    companyId,
    userId: new ObjectId(userId),
    startDate: "2026-08-18",
    endDate: "2026-08-18",
    startTime: null,
    endTime: null,
    reason: "krankheit",
    sourceTaskId: taskAId,
    sourceDeviationId: deviation.id,
  };

  const selfConflicts = await findExecutionCrewConflicts({
    db: conflictDb({ companyId, absences: [absence] }),
    companyId: companyId.toString(),
    task: taskA,
  });
  assert.deepEqual(selfConflicts, []);

  const taskB = {
    _id: taskBId,
    companyId,
    scheduledStart: "2026-08-18",
    scheduledEnd: "2026-08-18",
    startTime: "07:00",
    endTime: "15:00",
    assignedUserIds: [new ObjectId(userId)],
  };
  const otherTaskConflicts = await findExecutionCrewConflicts({
    db: conflictDb({ companyId, candidates: [taskA], absences: [absence] }),
    companyId: companyId.toString(),
    task: taskB,
  });
  assert.deepEqual(otherTaskConflicts.map((conflict) => conflict.type), ["absence"]);
  assert.equal(otherTaskConflicts[0]?.day, "2026-08-18");
});

test("team override removals are excluded from effective crew and bookings", () => {
  const task = {
    scheduledStart: "2026-08-18",
    scheduledEnd: "2026-08-18",
    assignedUserIds: [userId],
    teamOverrides: [{ outUserId: userId, inUserId: null, reason: "sonstiges" }],
  };
  assert.deepEqual(getEffectiveExecutionCrewUserIds(task), []);
  assert.equal(getExecutionUserBooking(task, userId), null);
});

test("an extra worker conflicts only on the assigned day and overlapping window", () => {
  const extraTask = getExecutionUserBooking({
    scheduledStart: "2026-08-18",
    scheduledEnd: "2026-08-20",
    assignedUserIds: [userId],
    extraAssignments: [{
      userId,
      role: "monteur",
      days: ["2026-08-19"],
      dayWindows: [{ day: "2026-08-19", startTime: "07:30", endTime: "11:30" }],
    }],
  }, userId);
  const before = getExecutionUserBooking({
    scheduledStart: "2026-08-19",
    scheduledEnd: "2026-08-19",
    assignedUserIds: [userId],
    startTime: "06:00",
    endTime: "07:30",
  }, userId);
  const overlap = getExecutionUserBooking({
    scheduledStart: "2026-08-19",
    scheduledEnd: "2026-08-19",
    assignedUserIds: [userId],
    startTime: "10:00",
    endTime: "12:00",
  }, userId);
  const otherDay = getExecutionUserBooking({
    scheduledStart: "2026-08-20",
    scheduledEnd: "2026-08-20",
    assignedUserIds: [userId],
    startTime: "08:00",
    endTime: "10:00",
  }, userId);
  assert.deepEqual(getExecutionBookingOverlap(extraTask, before), []);
  assert.deepEqual(getExecutionBookingOverlap(extraTask, overlap), ["2026-08-19"]);
  assert.deepEqual(getExecutionBookingOverlap(extraTask, otherDay), []);
});

test("replacement deviations generate deterministic extra assignments", () => {
  const replacementUserId = new ObjectId().toString();
  const deviations = normalizeStoredCrewDeviations([
    {
      id: "dev_1",
      userId,
      type: "krank",
      days: ["2026-08-27"],
      startTime: "10:00",
      endTime: "15:00",
      replacementUserId,
    },
    {
      id: "dev_2",
      userId,
      type: "krank",
      days: ["2026-08-28"],
      startTime: "10:00",
      endTime: "15:00",
      replacementUserId,
    },
  ]);
  const generated = applyCrewDeviationReplacements([], deviations, "monteur");
  assert.deepEqual(generated, [{
    userId: replacementUserId,
    role: "monteur",
    sourceTeamId: null,
    days: ["2026-08-27", "2026-08-28"],
    startTime: "10:00",
    endTime: "15:00",
    dayWindows: [
      { day: "2026-08-27", startTime: "10:00", endTime: "15:00" },
      { day: "2026-08-28", startTime: "10:00", endTime: "15:00" },
    ],
    note: "",
    replacementForDeviationIds: ["dev_1", "dev_2"],
  }]);
  assert.deepEqual(applyCrewDeviationReplacements(generated, [], "monteur"), []);
  const existingManual = [{
    userId: replacementUserId,
    role: "leiter",
    sourceTeamId: null,
    days: ["2026-08-26"],
    startTime: null,
    endTime: null,
    dayWindows: null,
    note: "Bestehender Eintrag",
  }];
  assert.deepEqual(applyCrewDeviationReplacements(existingManual, deviations, "monteur"), [{
    ...existingManual[0],
    days: ["2026-08-26", "2026-08-27", "2026-08-28"],
    startTime: null,
    endTime: null,
    dayWindows: [
      { day: "2026-08-26", startTime: null, endTime: null },
      { day: "2026-08-27", startTime: "10:00", endTime: "15:00" },
      { day: "2026-08-28", startTime: "10:00", endTime: "15:00" },
    ],
  }]);
});

test("full-day replacement uses the affected employee planned day window", () => {
  const replacementUserId = new ObjectId().toString();
  const deviations = normalizeStoredCrewDeviations([{
    id: "dev_sick",
    userId,
    type: "krank",
    days: ["2026-08-28"],
    startTime: null,
    endTime: null,
    replacementUserId,
  }]);
  const generated = applyCrewDeviationReplacements([], deviations, "monteur", [], {
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-09-01",
    taskStartTime: "07:00",
    taskEndTime: "15:00",
    sourceAssignments: [{
      userId,
      role: "leiter",
      days: ["2026-08-28"],
      dayWindows: [{ day: "2026-08-28", startTime: "08:00", endTime: "14:00" }],
    }],
  });
  assert.deepEqual(generated[0].dayWindows, [
    { day: "2026-08-28", startTime: "08:00", endTime: "14:00" },
  ]);
});

test("mutation locks reject a concurrent booking for the same employee day", async () => {
  const active = new Set<string>();
  const locks = {
    createIndex: async () => "ok",
    deleteOne: async () => ({ deletedCount: 0 }),
    insertOne: async (doc: any) => {
      if (active.has(doc._id)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      active.add(doc._id);
      return { insertedId: doc._id };
    },
    deleteMany: async (filter: any) => {
      for (const id of filter._id.$in) active.delete(id);
      return { deletedCount: filter._id.$in.length };
    },
  };
  const db = { collection: () => locks } as any;
  const companyId = new ObjectId().toString();
  const task = {
    scheduledStart: "2026-08-25",
    scheduledEnd: "2026-08-25",
    assignedUserIds: [userId],
  };
  const lockIds = getExecutionCrewMutationLockIds(companyId, [task]);
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = withExecutionCrewMutationLocks({
    db,
    lockIds,
    run: async () => {
      firstStarted();
      await release;
      return "saved";
    },
  });
  await started;
  await assert.rejects(
    withExecutionCrewMutationLocks({ db, lockIds, run: async () => "second" }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "CREW_UPDATE_IN_PROGRESS",
  );
  releaseFirst();
  assert.equal(await first, "saved");
});

test("daily audit entries preserve actor, day and before/after values", () => {
  const [entry] = normalizeExecutionScheduleHistory([{
    type: "day_updated",
    changedAt: new Date("2026-08-14T07:02:00.000Z"),
    changedByUserId: new ObjectId(userId),
    changedByName: "Dawid Beckham",
    actorName: "Dawid Beckham",
    userId: new ObjectId(userId),
    day: "2026-08-26",
    before: { startTime: "07:00", endTime: "15:00" },
    after: { startTime: "08:00", endTime: "14:00" },
  }]);
  assert.equal(entry.type, "day_updated");
  assert.equal(entry.day, "2026-08-26");
  assert.equal(entry.actorName, "Dawid Beckham");
  assert.deepEqual(entry.before, { startTime: "07:00", endTime: "15:00" });
  assert.deepEqual(entry.after, { startTime: "08:00", endTime: "14:00" });
});

test("rejects invalid and out-of-range extra-assignment days", async () => {
  await assert.rejects(
    normalizeAndValidateAdditionalCrew({
      db: {} as any,
      companyId: new ObjectId().toString(),
      mainTeamId: null,
      additionalTeamIds: [],
      extraAssignments: [{ userId, role: "monteur", days: ["2026-08-13"] }],
      scheduledStart: new Date("2026-08-10T00:00:00.000Z"),
      scheduledEnd: new Date("2026-08-12T00:00:00.000Z"),
    }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "EXTRA_ASSIGNMENT_DAY_OUTSIDE_SCHEDULE",
  );
  await assert.rejects(
    normalizeAndValidateAdditionalCrew({
      db: {} as any,
      companyId: new ObjectId().toString(),
      mainTeamId: null,
      additionalTeamIds: [],
      extraAssignments: [{ userId, role: "monteur", days: ["10.08.2026"] }],
      scheduledStart: new Date("2026-08-10T00:00:00.000Z"),
      scheduledEnd: new Date("2026-08-12T00:00:00.000Z"),
    }),
    /ISO-Daten/,
  );
});

test("rejects incomplete, malformed and reversed time windows", async () => {
  for (const assignment of [
    { startTime: "07:00", endTime: null },
    { startTime: "7:00", endTime: "15:00" },
    { startTime: "15:00", endTime: "07:00" },
  ]) {
    await assert.rejects(normalizeAndValidateAdditionalCrew({
      db: {} as any,
      companyId: new ObjectId().toString(),
      mainTeamId: null,
      additionalTeamIds: [],
      extraAssignments: [{ userId, role: "monteur", days: null, ...assignment }],
      scheduledStart: new Date("2026-08-10T00:00:00.000Z"),
      scheduledEnd: new Date("2026-08-12T00:00:00.000Z"),
    }), ExecutionCrewRequestError);
  }
});

test("partial-day bookings conflict only when day and time overlap", () => {
  const first = getExecutionUserBooking({
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-12",
    assignedUserIds: [userId],
    extraAssignments: [{
      userId,
      role: "monteur",
      days: ["2026-08-11"],
      startTime: "07:00",
      endTime: "11:00",
    }],
  }, userId);
  const touching = getExecutionUserBooking({
    scheduledStart: "2026-08-11",
    scheduledEnd: "2026-08-11",
    assignedUserIds: [userId],
    startTime: "11:00",
    endTime: "15:00",
  }, userId);
  const overlapping = getExecutionUserBooking({
    scheduledStart: "2026-08-11",
    scheduledEnd: "2026-08-11",
    assignedUserIds: [userId],
    startTime: "10:30",
    endTime: "12:00",
  }, userId);
  assert.deepEqual(getExecutionBookingOverlap(first, touching), []);
  assert.deepEqual(getExecutionBookingOverlap(first, overlapping), ["2026-08-11"]);
});

test("execution-task serialization round-trips the new fields", () => {
  const teamId = new ObjectId();
  const normalized = normalizeExecutionTask({
    _id: new ObjectId(),
    companyId: new ObjectId(),
    track: "montage",
    additionalTeamIds: [teamId],
    extraAssignments: [{
      userId: new ObjectId(userId),
      role: "monteur",
      sourceTeamId: teamId,
      days: ["2026-08-12", "2026-08-16"],
      startTime: "07:00",
      endTime: "15:00",
      note: "Test",
    }],
    assignedUserIds: [new ObjectId(userId)],
  });
  assert.deepEqual(normalized.additionalTeamIds, [teamId.toString()]);
  assert.deepEqual(normalized.extraAssignments, [{
    userId,
    role: "monteur",
    sourceTeamId: teamId.toString(),
    days: ["2026-08-12", "2026-08-16"],
    startTime: "07:00",
    endTime: "15:00",
    dayWindows: null,
    note: "Test",
  }]);
});

test("validates dayWindows dates, uniqueness, membership and time ranges", async () => {
  const base = {
    db: {} as any,
    companyId: new ObjectId().toString(),
    mainTeamId: null,
    additionalTeamIds: [],
    scheduledStart: new Date("2026-08-10T00:00:00.000Z"),
    scheduledEnd: new Date("2026-08-12T00:00:00.000Z"),
  };
  const invalid: Array<[any[], string]> = [
    [[{ day: "2026-08-13", startTime: null, endTime: null }], "EXTRA_ASSIGNMENT_DAY_WINDOW_OUTSIDE_SCHEDULE"],
    [[
      { day: "2026-08-11", startTime: null, endTime: null },
      { day: "2026-08-11", startTime: "12:00", endTime: "17:00" },
    ], "DUPLICATE_EXTRA_ASSIGNMENT_DAY_WINDOW"],
    [[{ day: "2026-08-11", startTime: "17:00", endTime: "12:00" }], "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOW_RANGE"],
    [[{ day: "2026-08-11", startTime: "7:00", endTime: "12:00" }], "INVALID_EXTRA_ASSIGNMENT_DAY_WINDOW_TIME"],
  ];
  for (const [dayWindows, code] of invalid) {
    await assert.rejects(
      normalizeAndValidateAdditionalCrew({
        ...base,
        extraAssignments: [{ userId, role: "monteur", dayWindows }],
      }),
      (error: any) => error instanceof ExecutionCrewRequestError && error.code === code,
    );
  }
  await assert.rejects(
    normalizeAndValidateAdditionalCrew({
      ...base,
      extraAssignments: [{
        userId,
        role: "monteur",
        days: ["2026-08-10"],
        dayWindows: [{ day: "2026-08-11", startTime: null, endTime: null }],
      }],
    }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "EXTRA_ASSIGNMENT_DAY_WINDOW_NOT_IN_DAYS",
  );
  await assert.rejects(
    normalizeAndValidateAdditionalCrew({
      ...base,
      extraAssignments: [{
        userId,
        role: "monteur",
        days: ["2026-08-11", "2026-08-11"],
      }],
    }),
    (error: any) => error instanceof ExecutionCrewRequestError && error.code === "DUPLICATE_EXTRA_ASSIGNMENT_DAY",
  );
});

test("derives days from dayWindows and round-trips windows unchanged", async () => {
  const companyId = new ObjectId();
  const dayWindows = [
    { day: "2026-08-10", startTime: "07:00", endTime: "15:00" },
    { day: "2026-08-11", startTime: "12:00", endTime: "17:00" },
    { day: "2026-08-12", startTime: null, endTime: null },
  ];
  const normalized = await normalizeAndValidateAdditionalCrew({
    db: {
      collection: (name: string) => name === "users"
        ? { find: () => ({ toArray: async () => [{
            _id: new ObjectId(userId),
            status: "active",
            memberships: [{ companyId, status: "active" }],
          }] }) }
        : { find: () => ({ toArray: async () => [] }) },
    } as any,
    companyId: companyId.toString(),
    mainTeamId: null,
    additionalTeamIds: [],
    extraAssignments: [{ userId, role: "monteur", dayWindows }],
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-12",
  });
  assert.deepEqual(normalized.extraAssignments[0].days, dayWindows.map((window) => window.day));
  assert.deepEqual(normalized.extraAssignments[0].dayWindows, dayWindows);

  // Stored normalization is the common read path used by list, detail, calendar and board clients.
  const [roundTrip] = normalizeStoredExtraAssignments([{
    userId,
    role: "monteur",
    days: dayWindows.map((window) => window.day),
    startTime: null,
    endTime: null,
    dayWindows,
    note: "Test",
  }]);
  assert.deepEqual(roundTrip.dayWindows, dayWindows);
  assert.deepEqual(roundTrip.days, dayWindows.map((window) => window.day));
});

test("checks conflicts independently for every day window", () => {
  const first = getExecutionUserBooking({
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-11",
    assignedUserIds: [userId],
    extraAssignments: [{
      userId,
      role: "monteur",
      days: ["2026-08-10", "2026-08-11"],
      startTime: null,
      endTime: null,
      dayWindows: [
        { day: "2026-08-10", startTime: "07:00", endTime: "12:00" },
        { day: "2026-08-11", startTime: "07:00", endTime: "15:00" },
      ],
    }],
  }, userId);
  const second = getExecutionUserBooking({
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-11",
    assignedUserIds: [userId],
    extraAssignments: [{
      userId,
      role: "monteur",
      days: ["2026-08-10", "2026-08-11"],
      startTime: null,
      endTime: null,
      dayWindows: [
        { day: "2026-08-10", startTime: "13:00", endTime: "17:00" },
        { day: "2026-08-11", startTime: "12:00", endTime: "17:00" },
      ],
    }],
  }, userId);
  assert.deepEqual(getExecutionBookingOverlap(first, second), ["2026-08-11"]);
});

test("derives idempotent migration windows and descriptive history", () => {
  assert.deepEqual(deriveExtraAssignmentDayWindows({
    days: ["2026-08-10", "2026-08-12"],
    startTime: "07:00",
    endTime: "15:00",
  }, "2026-08-10", "2026-08-12"), [
    { day: "2026-08-10", startTime: "07:00", endTime: "15:00" },
    { day: "2026-08-12", startTime: "07:00", endTime: "15:00" },
  ]);
  assert.deepEqual(deriveExtraAssignmentDayWindows({
    days: null,
    startTime: null,
    endTime: null,
  }, "2026-08-10", "2026-08-11"), [
    { day: "2026-08-10", startTime: null, endTime: null },
    { day: "2026-08-11", startTime: null, endTime: null },
  ]);
  const next = normalizeStoredExtraAssignments([{
    userId,
    role: "monteur",
    dayWindows: [{ day: "2026-08-13", startTime: "12:00", endTime: "17:00" }],
  }])[0];
  assert.deepEqual(
    buildExtraAssignmentDayWindowHistoryTexts(null, next, "Lena Koch"),
    ["Zusatzkraft Lena Koch: 13.08.2026 auf 12:00–17:00 geändert"],
  );
});
