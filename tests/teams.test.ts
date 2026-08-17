import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  deriveAssignedUserIds,
  hasAvailabilityOverlap,
  normalizeTeamMembers,
  normalizeStoredTeamOverrides,
  normalizeTeamTracks,
  parseAvailabilityDate,
} from "../src/lib/teams";

test("normalizes team tracks and rejects duplicate members", () => {
  assert.deepEqual(normalizeTeamTracks(["montage", "elektro", "montage", "invalid"]), [
    "montage",
    "elektro",
  ]);
  const userId = new ObjectId().toString();
  assert.throws(
    () =>
      normalizeTeamMembers([
        { userId, role: "monteur" },
        { userId, role: "leiter" },
      ]),
    /nur einmal/,
  );
});

test("derives the effective crew from the latest override per team member", () => {
  const a = new ObjectId().toString();
  const b = new ObjectId().toString();
  const c = new ObjectId().toString();
  const d = new ObjectId().toString();

  assert.deepEqual(new Set(deriveAssignedUserIds([a, b], [])), new Set([a, b]));
  assert.deepEqual(
    new Set(
      deriveAssignedUserIds([a, b], [
        { outUserId: a, inUserId: c },
        { outUserId: a, inUserId: d },
        { outUserId: b, inUserId: null },
      ]),
    ),
    new Set([d]),
  );
});

test("team override serialization preserves frontend audit aliases", () => {
  const outUserId = new ObjectId();
  assert.deepEqual(normalizeStoredTeamOverrides([{
    outUserId,
    inUserId: null,
    reason: "krankheit",
    note: "Arztzeug folgt",
    actorName: "Max Müller",
    at: "2026-08-13T11:34:00.000Z",
    kind: "absent",
  }]), [{
    outUserId: outUserId.toString(),
    inUserId: null,
    reason: "krankheit",
    note: "Arztzeug folgt",
    createdAt: "",
    createdByUserId: null,
    actorName: "Max Müller",
    at: "2026-08-13T11:34:00.000Z",
    kind: "absent",
  }]);
});

test("availability uses inclusive day overlap", () => {
  const requested = {
    start: new Date("2026-08-10T00:00:00.000Z"),
    end: new Date("2026-08-12T23:59:59.999Z"),
  };
  assert.equal(
    hasAvailabilityOverlap(requested, {
      scheduledStart: "2026-08-12T00:00:00.000Z",
      scheduledEnd: "2026-08-13T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    hasAvailabilityOverlap(requested, {
      scheduledStart: "2026-08-13T00:00:00.000Z",
      scheduledEnd: "2026-08-14T00:00:00.000Z",
    }),
    false,
  );
});

test("availability applies time overlap only when both intervals are timed single days", () => {
  const requested = {
    start: new Date("2026-08-10T00:00:00.000Z"),
    end: new Date("2026-08-10T23:59:59.999Z"),
    startTime: "08:00",
    endTime: "12:00",
  };
  assert.equal(
    hasAvailabilityOverlap(requested, {
      scheduledStart: "2026-08-10T00:00:00.000Z",
      scheduledEnd: "2026-08-10T00:00:00.000Z",
      startTime: "12:00",
      endTime: "16:00",
    }),
    false,
  );
  assert.equal(
    hasAvailabilityOverlap(requested, {
      scheduledStart: "2026-08-10T00:00:00.000Z",
      scheduledEnd: "2026-08-10T00:00:00.000Z",
      startTime: "11:59",
      endTime: "16:00",
    }),
    true,
  );
  assert.equal(
    hasAvailabilityOverlap(requested, {
      scheduledStart: "2026-08-10T00:00:00.000Z",
      scheduledEnd: "2026-08-10T00:00:00.000Z",
    }),
    true,
  );
});

test("parses only YYYY-MM-DD availability dates", () => {
  assert.equal(parseAvailabilityDate("2026-08-10")?.toISOString(), "2026-08-10T00:00:00.000Z");
  assert.equal(parseAvailabilityDate("10.08.2026"), null);
});
