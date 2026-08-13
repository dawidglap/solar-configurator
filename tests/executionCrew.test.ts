import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  buildExtraAssignmentDayWindowHistoryTexts,
  deriveExtraAssignmentDayWindows,
  ExecutionCrewRequestError,
  getExecutionBookingOverlap,
  getExecutionUserBooking,
  normalizeAndValidateAdditionalCrew,
  normalizeStoredExtraAssignments,
} from "../src/lib/executionCrew";
import { normalizeExecutionTask } from "../src/lib/executionTasks";

const userId = new ObjectId().toString();

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
