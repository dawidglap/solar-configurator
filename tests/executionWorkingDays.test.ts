import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  deriveExecutionWorkingDays,
  ExecutionWorkingDaysError,
  resolveExecutionWorkingDayFields,
} from "../src/lib/executionWorkingDays";
import {
  getExecutionBookingOverlap,
  getExecutionUserBooking,
} from "../src/lib/executionCrew";
import { normalizeExecutionTask } from "../src/lib/executionTasks";
import { hasAvailabilityOverlap } from "../src/lib/teams";

const userId = new ObjectId().toString();

test("derives inclusive working days and excludes Saturday and Sunday by default", () => {
  assert.deepEqual(
    deriveExecutionWorkingDays({
      scheduledStart: "2026-08-14",
      scheduledEnd: "2026-08-17",
    }),
    ["2026-08-14", "2026-08-17"],
  );
});

test("supports custom excluded weekdays and validates provided workingDays", () => {
  const fields = resolveExecutionWorkingDayFields({
    scheduledStart: "2026-08-14",
    scheduledEnd: "2026-08-17",
    excludedWeekdays: [0],
    workingDays: ["2026-08-14", "2026-08-15", "2026-08-17"],
  });
  assert.deepEqual(fields, {
    excludedWeekdays: [0],
    workingDays: ["2026-08-14", "2026-08-15", "2026-08-17"],
  });
  assert.throws(
    () => resolveExecutionWorkingDayFields({
      scheduledStart: "2026-08-14",
      scheduledEnd: "2026-08-17",
      workingDays: ["2026-08-14", "2026-08-15", "2026-08-17"],
    }),
    (error: any) =>
      error instanceof ExecutionWorkingDaysError && error.code === "WORKING_DAYS_MISMATCH",
  );
});

test("legacy tasks expose an empty excluded-weekday default through every normalized GET payload", () => {
  const task = normalizeExecutionTask({
    _id: new ObjectId(),
    companyId: new ObjectId(),
    track: "montage",
    scheduledStart: new Date("2026-08-14T00:00:00.000Z"),
    scheduledEnd: new Date("2026-08-17T00:00:00.000Z"),
  });
  assert.deepEqual(task.excludedWeekdays, []);
  assert.deepEqual(task.workingDays, ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"]);
});

test("crew bookings and double-booking checks ignore excluded weekend days", () => {
  const weekendOnly = getExecutionUserBooking({
    scheduledStart: "2026-08-15",
    scheduledEnd: "2026-08-16",
    excludedWeekdays: [0, 6],
    assignedUserIds: [userId],
  }, userId);
  const saturdayWork = getExecutionUserBooking({
    scheduledStart: "2026-08-15",
    scheduledEnd: "2026-08-15",
    excludedWeekdays: [0],
    workingDays: ["2026-08-15"],
    assignedUserIds: [userId],
  }, userId);

  assert.deepEqual(weekendOnly?.days, []);
  assert.deepEqual(saturdayWork?.days, ["2026-08-15"]);
  assert.deepEqual(getExecutionBookingOverlap(weekendOnly, saturdayWork), []);
  assert.equal(
    hasAvailabilityOverlap(
      {
        start: new Date("2026-08-15T00:00:00.000Z"),
        end: new Date("2026-08-16T23:59:59.999Z"),
      },
      {
        scheduledStart: "2026-08-15",
        scheduledEnd: "2026-08-16",
      },
    ),
    false,
  );
});
