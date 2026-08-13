import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  applyCrewDeviationReplacements,
  buildExtraAssignmentDayWindowHistoryTexts,
  deriveExtraAssignmentDayWindows,
  ExecutionCrewRequestError,
  getExecutionBookingOverlap,
  getExecutionUserBooking,
  normalizeAndValidateAdditionalCrew,
  normalizeAndValidateCrewDeviations,
  normalizeStoredCrewDeviations,
  normalizeStoredExtraAssignments,
} from "../src/lib/executionCrew";
import { normalizeExecutionTask } from "../src/lib/executionTasks";

const userId = new ObjectId().toString();

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
    actorName: "Max Müller",
  };
  const cases: Array<[any, string]> = [
    [{ id: "dev_1", userId, type: "homeoffice", days: ["2026-08-27"] }, "UNKNOWN_DEVIATION_TYPE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-29"] }, "DEVIATION_DAY_OUTSIDE_SCHEDULE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27", "2026-08-27"] }, "DUPLICATE_DEVIATION_DAY"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27"], startTime: "15:00", endTime: "10:00" }, "INVALID_DEVIATION_TIME_RANGE"],
    [{ id: "dev_1", userId, type: "krank", days: ["2026-08-27"], replacementUserId: userId }, "DEVIATION_REPLACEMENT_SAME_USER"],
  ];
  for (const [deviation, code] of cases) {
    await assert.rejects(
      normalizeAndValidateCrewDeviations({ ...base, input: [deviation] }),
      (error: any) => error instanceof ExecutionCrewRequestError && error.code === code,
    );
  }
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
      days: ["2026-08-27", "2026-08-28"],
      startTime: "10:00",
      endTime: "15:00",
      global: false,
      note: "Arztzeug folgt",
      actorName: "Max Müller",
      at,
    }],
    scheduledStart: "2026-08-27",
    scheduledEnd: "2026-08-28",
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

test("replacement deviations generate deterministic extra assignments", () => {
  const replacementUserId = new ObjectId().toString();
  const deviations = normalizeStoredCrewDeviations([{
    id: "dev_1",
    userId,
    type: "krank",
    days: ["2026-08-27", "2026-08-28"],
    startTime: "10:00",
    endTime: "15:00",
    replacementUserId,
  }]);
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
    replacementForDeviationIds: ["dev_1"],
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
    days: ["2026-08-27", "2026-08-28"],
    startTime: "10:00",
    endTime: "15:00",
    dayWindows: [
      { day: "2026-08-27", startTime: "10:00", endTime: "15:00" },
      { day: "2026-08-28", startTime: "10:00", endTime: "15:00" },
    ],
  }]);
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
