import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  AbsenceRequestError,
  buildAbsenceOverlapFilter,
  getAbsenceBooking,
  normalizeAbsenceInput,
  parseAbsenceDate,
  serializeAbsence,
} from "../src/lib/absences";
import { getExecutionBookingOverlap, getExecutionUserBooking } from "../src/lib/executionCrew";

const userId = new ObjectId();

test("normalizes an absence and defaults endDate to startDate", () => {
  const normalized = normalizeAbsenceInput({
    userId: userId.toString(),
    startDate: "2026-08-10",
    reason: " KRANKHEIT ",
    note: " Arztzeug folgt ",
  });

  assert.equal(normalized.userId.toString(), userId.toString());
  assert.equal(normalized.startDate, "2026-08-10");
  assert.equal(normalized.endDate, "2026-08-10");
  assert.equal(normalized.startTime, null);
  assert.equal(normalized.endTime, null);
  assert.equal(normalized.reason, "krankheit");
  assert.equal(normalized.note, "Arztzeug folgt");
  assert.equal(normalized.sourceTaskId, null);
});

test("rejects invalid dates, time ranges and reasons with stable codes", () => {
  const base = { userId: userId.toString(), startDate: "2026-08-10", reason: "ferien" };
  const cases: Array<[any, string]> = [
    [{ ...base, startDate: "2026-02-30" }, "INVALID_START_DATE"],
    [{ ...base, endDate: "2026-08-09" }, "INVALID_DATE_RANGE"],
    [{ ...base, startTime: "08:00" }, "INCOMPLETE_TIME_RANGE"],
    [{ ...base, startTime: "8:00", endTime: "12:00" }, "INVALID_TIME"],
    [{ ...base, startTime: "12:00", endTime: "12:00" }, "INVALID_TIME_RANGE"],
    [{ ...base, reason: "homeoffice" }, "UNKNOWN_REASON"],
  ];

  for (const [input, code] of cases) {
    assert.throws(
      () => normalizeAbsenceInput(input),
      (error: any) => error instanceof AbsenceRequestError && error.code === code,
    );
  }
});

test("absence overlap is inclusive and respects partial-day times", () => {
  const requested = getExecutionUserBooking({
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-12",
    assignedUserIds: [userId],
    startTime: "08:00",
    endTime: "12:00",
  }, userId.toString());

  assert.deepEqual(
    getExecutionBookingOverlap(requested, getAbsenceBooking({
      startDate: "2026-08-12",
      endDate: "2026-08-13",
      startTime: "11:00",
      endTime: "13:00",
    })),
    ["2026-08-12"],
  );
  assert.deepEqual(
    getExecutionBookingOverlap(requested, getAbsenceBooking({
      startDate: "2026-08-12",
      endDate: "2026-08-12",
      startTime: "12:00",
      endTime: "14:00",
    })),
    [],
  );
  assert.deepEqual(
    getExecutionBookingOverlap(requested, getAbsenceBooking({
      startDate: "2026-08-11",
      endDate: "2026-08-11",
      startTime: null,
      endTime: null,
    })),
    ["2026-08-11"],
  );
});

test("serializes the frontend contract in camelCase", () => {
  const absenceId = new ObjectId();
  const sourceTaskId = new ObjectId();
  assert.deepEqual(serializeAbsence({
    _id: absenceId,
    userId,
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    startTime: null,
    endTime: null,
    reason: "ferien",
    note: "Sommerferien",
    sourceTaskId,
  }), {
    id: absenceId.toString(),
    userId: userId.toString(),
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    startTime: null,
    endTime: null,
    reason: "ferien",
    note: "Sommerferien",
    sourceTaskId: sourceTaskId.toString(),
  });
});

test("builds a company-wide inclusive date-overlap filter", () => {
  assert.deepEqual(buildAbsenceOverlapFilter("2026-08-10", "2026-08-12"), {
    startDate: { $lte: "2026-08-12" },
    endDate: { $gte: "2026-08-10" },
  });
  assert.equal(parseAbsenceDate("2026-08-10"), "2026-08-10");
  assert.equal(parseAbsenceDate("10.08.2026"), null);
});
