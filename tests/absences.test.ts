import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  AbsenceRequestError,
  buildAbsenceOverlapFilter,
  cleanupOrphanedCrewDeviationAbsences,
  getAbsenceBooking,
  isAbsenceFromTask,
  normalizeAbsenceInput,
  parseAbsenceDate,
  serializeAbsence,
  syncCrewDeviationAbsences,
} from "../src/lib/absences";
import { normalizeStoredCrewDeviations } from "../src/lib/executionCrew";
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

test("recognizes mirrored absences from the excluded task", () => {
  const taskId = new ObjectId();
  assert.equal(isAbsenceFromTask({ sourceTaskId: taskId }, taskId.toString()), true);
  assert.equal(isAbsenceFromTask({ sourceTaskId: new ObjectId() }, taskId), false);
  assert.equal(isAbsenceFromTask({ sourceTaskId: null }, taskId), false);
});

test("global crew deviations idempotently create, update and remove linked absences", async () => {
  const companyId = new ObjectId();
  const taskId = new ObjectId();
  const docs: any[] = [];
  const collection = {
    createIndex: async () => "ok",
    find: () => ({ toArray: async () => [...docs] }),
    deleteMany: async (filter: any) => {
      const ids = new Set((filter?._id?.$in ?? []).map((id: ObjectId) => id.toString()));
      let removed = 0;
      for (let index = docs.length - 1; index >= 0; index -= 1) {
        if (ids.has(docs[index]._id.toString())) {
          docs.splice(index, 1);
          removed += 1;
        }
      }
      return { deletedCount: removed };
    },
    updateOne: async (filter: any, update: any) => {
      let doc = docs.find((item) => item.sourceDeviationId === filter.sourceDeviationId);
      if (!doc) {
        doc = { _id: new ObjectId(), ...update.$setOnInsert };
        docs.push(doc);
      }
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const db = { collection: (name: string) => {
    assert.equal(name, "absences");
    return collection;
  } } as any;
  const deviation = normalizeStoredCrewDeviations([{
    id: "dev_global",
    userId,
    type: "unfall",
    days: ["2026-08-27"],
    startTime: null,
    endTime: null,
    note: "Test",
  }]);

  await syncCrewDeviationAbsences({
    db,
    companyId: companyId.toString(),
    taskId: taskId.toString(),
    crewDeviations: deviation,
    actorUserId: userId.toString(),
  });
  await syncCrewDeviationAbsences({
    db,
    companyId: companyId.toString(),
    taskId: taskId.toString(),
    crewDeviations: deviation,
    actorUserId: userId.toString(),
  });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].reason, "krankheit");
  assert.equal(docs[0].startDate, "2026-08-27");
  assert.equal(docs[0].endDate, "2026-08-27");
  assert.equal(docs[0].sourceDeviationId, "dev_global");

  await syncCrewDeviationAbsences({
    db,
    companyId: companyId.toString(),
    taskId: taskId.toString(),
    crewDeviations: [],
  });
  assert.equal(docs.length, 0);
});

test("multi-day vacation is mirrored as independent daily absences", async () => {
  const companyId = new ObjectId();
  const taskId = new ObjectId();
  const docs: any[] = [];
  const collection = {
    createIndex: async () => "ok",
    find: () => ({ toArray: async () => [...docs] }),
    deleteMany: async () => ({ deletedCount: 0 }),
    updateOne: async (filter: any, update: any) => {
      let doc = docs.find((item) => item.sourceDeviationId === filter.sourceDeviationId);
      if (!doc) {
        doc = { _id: new ObjectId(), ...update.$setOnInsert };
        docs.push(doc);
      }
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const db = { collection: () => collection } as any;
  const deviations = normalizeStoredCrewDeviations([
    { id: "ferien_25", userId, type: "ferien", days: ["2026-08-25"] },
    { id: "ferien_26", userId, type: "ferien", days: ["2026-08-26"] },
  ]);
  await syncCrewDeviationAbsences({
    db,
    companyId: companyId.toString(),
    taskId: taskId.toString(),
    crewDeviations: deviations,
  });
  assert.deepEqual(docs.map((doc) => [doc.startDate, doc.endDate, doc.reason]), [
    ["2026-08-25", "2026-08-25", "ferien"],
    ["2026-08-26", "2026-08-26", "ferien"],
  ]);
});

test("orphaned mirrored absences are removed idempotently", async () => {
  const companyId = new ObjectId();
  const taskId = new ObjectId();
  const validAbsence = {
    _id: new ObjectId(),
    companyId,
    userId,
    sourceTaskId: taskId,
    sourceDeviationId: "dev_valid",
  };
  const orphanedAbsence = {
    _id: new ObjectId(),
    companyId,
    userId,
    sourceTaskId: taskId,
    sourceDeviationId: "dev_deleted",
  };
  const absences = [validAbsence, orphanedAbsence];
  const db = {
    collection: (name: string) => {
      if (name === "absences") return {
        find: () => ({ toArray: async () => [...absences] }),
        deleteMany: async (filter: any) => {
          const ids = new Set(filter._id.$in.map((id: ObjectId) => id.toString()));
          for (let index = absences.length - 1; index >= 0; index -= 1) {
            if (ids.has(absences[index]._id.toString())) absences.splice(index, 1);
          }
          return { deletedCount: ids.size };
        },
      };
      if (name === "executionTasks") return {
        find: () => ({ toArray: async () => [{
          _id: taskId,
          companyId,
          crewDeviations: [{ id: "dev_valid", userId }],
        }] }),
      };
      throw new Error(`Unexpected collection ${name}`);
    },
  } as any;

  const first = await cleanupOrphanedCrewDeviationAbsences(db);
  assert.deepEqual(first, { matched: 2, removed: 1 });
  assert.deepEqual(absences.map((absence) => absence.sourceDeviationId), ["dev_valid"]);
  const second = await cleanupOrphanedCrewDeviationAbsences(db);
  assert.deepEqual(second, { matched: 1, removed: 0 });
});
