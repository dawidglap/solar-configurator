import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  ExecutionCrewRequestError,
  getExecutionBookingOverlap,
  getExecutionUserBooking,
  normalizeAndValidateAdditionalCrew,
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
    note: "Test",
  }]);
});
