import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "../src/lib/db";
import { GET as listTeams, POST as createTeam } from "../src/app/api/teams/route";
import { PATCH as patchTeam } from "../src/app/api/teams/[teamId]/route";
import { GET as getAvailability } from "../src/app/api/teams/[teamId]/availability/route";
import { PATCH as patchExecutionTask } from "../src/app/api/execution-tasks/[taskId]/route";
import { GET as getExecutionTask } from "../src/app/api/execution-tasks/[taskId]/route";
import { POST as validateExecutionCrew } from "../src/app/api/execution-tasks/[taskId]/validate-crew/route";

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `session=${payload}.${signature}`;
}

async function responseJson(response: Response) {
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;
  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  const client = new MongoClient(uri);
  const companyId = new ObjectId();
  const actorId = new ObjectId();
  const memberA = new ObjectId();
  const memberB = new ObjectId();
  const replacement = new ObjectId();
  const additionalMemberA = new ObjectId();
  const additionalMemberB = new ObjectId();
  const extraWorker = new ObjectId();
  const taskId = new ObjectId();
  const conflictingTaskId = new ObjectId();
  const partialConflictTaskId = new ObjectId();
  const cookie = buildSessionCookie(
    {
      userId: actorId.toString(),
      activeCompanyId: companyId.toString(),
      role: "admin",
      firstName: "Team",
      lastName: "Tester",
    },
    secret,
  );

  try {
    await client.connect();
    const db = client.db();
    const now = new Date();
    await db.collection("companies").insertOne({
      _id: companyId,
      name: "Execution Teams Test Company",
      plan: "starter",
      subscriptionStatus: "trial",
      validUntil: new Date(Date.now() + 86_400_000),
      maxUsers: 10,
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
    const testUsers: Array<[ObjectId, string, string]> = [
      [actorId, "Team", "Tester"],
      [memberA, "Anna", "Montage"],
      [memberB, "Bruno", "Montage"],
      [replacement, "Carla", "Ersatz"],
      [additionalMemberA, "Dario", "Zusatz"],
      [additionalMemberB, "Eva", "Zusatz"],
      [extraWorker, "Lena", "Koch"],
    ];
    await db.collection("users").insertMany(
      testUsers.map(([id, firstName, lastName]) => ({
        _id: id,
        firstName,
        lastName,
        email: `${String(firstName).toLowerCase()}@example.com`,
        status: "active",
        memberships: [{ companyId, role: "user", status: "active" }],
        executionRoles: ["montage"],
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.collection("executionTasks").insertMany([
      {
        _id: taskId,
        companyId: companyId.toString(),
        projectId: new ObjectId().toString(),
        planningId: new ObjectId().toString(),
        track: "montage",
        stage: "offen",
        teamId: null,
        teamOverrides: [],
        assignedUserIds: [],
        scheduledStart: null,
        scheduledEnd: null,
        startTime: null,
        endTime: null,
        address: {},
        notes: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: conflictingTaskId,
        companyId: companyId.toString(),
        projectId: new ObjectId().toString(),
        planningId: new ObjectId().toString(),
        track: "montage",
        stage: "geplant",
        teamId: null,
        teamOverrides: [],
        assignedUserIds: [memberB],
        scheduledStart: new Date("2026-08-10T00:00:00.000Z"),
        scheduledEnd: new Date("2026-08-10T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "12:00",
        planningTitle: "Andere Baustelle",
        address: {},
        notes: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: partialConflictTaskId,
        companyId: companyId.toString(),
        projectId: new ObjectId().toString(),
        planningId: new ObjectId().toString(),
        track: "montage",
        stage: "geplant",
        teamId: null,
        teamOverrides: [],
        additionalTeamIds: [],
        extraAssignments: [],
        assignedUserIds: [extraWorker],
        scheduledStart: new Date("2026-08-11T00:00:00.000Z"),
        scheduledEnd: new Date("2026-08-11T00:00:00.000Z"),
        startTime: "10:30",
        endTime: "12:00",
        planningTitle: "Teilzeit-Konflikt",
        address: {},
        notes: "",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const createResponse = await createTeam(
      new Request("http://localhost/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          name: "Team Nord",
          color: "hsl(210 80% 58%)",
          tracks: ["montage", "elektro"],
          members: [
            { userId: memberA.toString(), role: "leiter" },
            { userId: memberB.toString(), role: "monteur" },
          ],
        }),
      }),
    );
    const created = await responseJson(createResponse);
    const teamId = created.item.id;
    assert.equal(created.item.members[0].fullName, "Anna Montage");

    const additionalTeam = await responseJson(
      await createTeam(
        new Request("http://localhost/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({
            name: "Team Zusatz",
            color: "hsl(160 60% 45%)",
            tracks: ["montage"],
            members: [
              { userId: additionalMemberA.toString(), role: "leiter" },
              { userId: additionalMemberB.toString(), role: "monteur" },
            ],
          }),
        }),
      ),
    );
    const additionalTeamId = additionalTeam.item.id;

    const duplicateResponse = await createTeam(
      new Request("http://localhost/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          name: "Team Konflikt",
          tracks: ["montage"],
          members: [{ userId: memberA.toString(), role: "monteur" }],
        }),
      }),
    );
    const duplicateBody = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 409);
    assert.equal(duplicateBody.code, "USER_ALREADY_IN_TEAM");
    assert.deepEqual(duplicateBody.conflictUserIds, [memberA.toString()]);

    const assigned = await responseJson(
      await patchExecutionTask(
        new Request(`http://localhost/api/execution-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ teamId, assignedUserIds: [replacement.toString()] }),
        }),
        { params: Promise.resolve({ taskId: taskId.toString() }) },
      ),
    );
    assert.deepEqual(new Set(assigned.item.assignedUserIds), new Set([memberA.toString(), memberB.toString()]));

    const overridden = await responseJson(
      await patchExecutionTask(
        new Request(`http://localhost/api/execution-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({
            teamId,
            teamOverrides: [
              {
                outUserId: memberA.toString(),
                inUserId: replacement.toString(),
                reason: "krankheit",
                note: "Test",
              },
            ],
          }),
        }),
        { params: Promise.resolve({ taskId: taskId.toString() }) },
      ),
    );
    assert.deepEqual(new Set(overridden.item.assignedUserIds), new Set([memberB.toString(), replacement.toString()]));
    assert.equal(overridden.item.teamOverrides.length, 1);
    assert.ok(overridden.item.teamOverrides[0].createdAt);
    const taskWithHistory = await db.collection("executionTasks").findOne({ _id: taskId });
    assert.equal(
      taskWithHistory?.scheduleHistory?.some((entry: any) => entry.type === "team_changed"),
      true,
    );

    const crewPatch = await responseJson(
      await patchExecutionTask(
        new Request(`http://localhost/api/execution-tasks/${taskId}?validate=1`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({
            scheduledStart: "2026-08-10",
            scheduledEnd: "2026-08-12",
            additionalTeamIds: [additionalTeamId],
            extraAssignments: [{
              userId: extraWorker.toString(),
              role: "monteur",
              sourceTeamId: null,
              days: ["2026-08-11"],
              startTime: null,
              endTime: null,
              dayWindows: [{
                day: "2026-08-11",
                startTime: "07:00",
                endTime: "11:00",
              }],
              note: "Nur Vormittag",
            }],
            assignedUserIds: [],
          }),
        }),
        { params: Promise.resolve({ taskId: taskId.toString() }) },
      ),
    );
    assert.deepEqual(new Set(crewPatch.item.assignedUserIds), new Set([
      memberB.toString(),
      replacement.toString(),
      additionalMemberA.toString(),
      additionalMemberB.toString(),
      extraWorker.toString(),
    ]));
    assert.deepEqual(crewPatch.item.additionalTeamIds, [additionalTeamId]);
    assert.deepEqual(crewPatch.item.extraAssignments, [{
      userId: extraWorker.toString(),
      role: "monteur",
      sourceTeamId: null,
      days: ["2026-08-11"],
      startTime: null,
      endTime: null,
      dayWindows: [{
        day: "2026-08-11",
        startTime: "07:00",
        endTime: "11:00",
      }],
      note: "Nur Vormittag",
    }]);
    const partialConflict = crewPatch.conflicts.find(
      (conflict: any) => conflict.conflictingTaskId === partialConflictTaskId.toString(),
    );
    assert.ok(partialConflict);
    assert.equal(partialConflict.day, "2026-08-11");
    assert.equal(partialConflict.startTime, "10:30");
    assert.equal(partialConflict.endTime, "12:00");
    assert.deepEqual(partialConflict.days, ["2026-08-11"]);

    const roundTrip = await responseJson(await getExecutionTask(
      new Request(`http://localhost/api/execution-tasks/${taskId}`, { headers: { cookie } }),
      { params: Promise.resolve({ taskId: taskId.toString() }) },
    ));
    assert.deepEqual(roundTrip.item.additionalTeamIds, crewPatch.item.additionalTeamIds);
    assert.deepEqual(roundTrip.item.extraAssignments, crewPatch.item.extraAssignments);

    const validateResult = await responseJson(await validateExecutionCrew(
      new Request(`http://localhost/api/execution-tasks/${taskId}/validate-crew`, {
        method: "POST",
        headers: { cookie },
      }),
      { params: Promise.resolve({ taskId: taskId.toString() }) },
    ));
    assert.equal(validateResult.conflicts.some(
      (conflict: any) => conflict.projectName === "Teilzeit-Konflikt",
    ), true);

    const invalidDay = await patchExecutionTask(
      new Request(`http://localhost/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          extraAssignments: [{
            userId: extraWorker.toString(),
            role: "monteur",
            days: ["2026-08-13"],
          }],
        }),
      }),
      { params: Promise.resolve({ taskId: taskId.toString() }) },
    );
    assert.equal(invalidDay.status, 400);
    const duplicateExtra = await patchExecutionTask(
      new Request(`http://localhost/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          extraAssignments: [
            { userId: extraWorker.toString(), role: "monteur", days: null },
            { userId: extraWorker.toString(), role: "leiter", days: null },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: taskId.toString() }) },
    );
    assert.equal(duplicateExtra.status, 400);
    const taskWithCrewHistory = await db.collection("executionTasks").findOne({ _id: taskId });
    assert.equal(taskWithCrewHistory?.scheduleHistory?.some(
      (entry: any) => entry.type === "additional_team_changed" && entry.action === "added",
    ), true);
    assert.equal(taskWithCrewHistory?.scheduleHistory?.some(
      (entry: any) => entry.type === "extra_assignment_changed" && entry.action === "added" && entry.text.includes("Lena Koch"),
    ), true);
    assert.equal(taskWithCrewHistory?.scheduleHistory?.some(
      (entry: any) => entry.type === "extra_assignment_changed" && entry.action === "day_window_updated" && entry.text.includes("11.08.2026 auf 07:00–11:00"),
    ), true);
    assert.equal(
      taskWithHistory?.scheduleHistory?.some(
        (entry: any) =>
          entry.type === "member_replaced" &&
          String(entry.outUserId) === memberA.toString() &&
          String(entry.inUserId) === replacement.toString(),
      ),
      true,
    );

    const availability = await responseJson(
      await getAvailability(
        new Request(
          `http://localhost/api/teams/${teamId}/availability?start=2026-08-10&end=2026-08-10&startTime=09:00&endTime=10:00&excludeTaskId=${taskId}`,
          { headers: { cookie } },
        ),
        { params: Promise.resolve({ teamId }) },
      ),
    );
    assert.equal(availability.conflicts.length, 1);
    assert.equal(availability.conflicts[0].userId, memberB.toString());
    assert.equal(availability.conflicts[0].taskTitle, "Andere Baustelle");

    const archived = await responseJson(
      await patchTeam(
        new Request(`http://localhost/api/teams/${teamId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ status: "archived" }),
        }),
        { params: Promise.resolve({ teamId }) },
      ),
    );
    assert.equal(archived.item.status, "archived");
    const storedTask = await db.collection("executionTasks").findOne({ _id: taskId });
    assert.equal(String(storedTask?.teamId), teamId);

    const listed = await responseJson(
      await listTeams(new Request("http://localhost/api/teams?status=archived", { headers: { cookie } })),
    );
    assert.equal(listed.items.some((item: any) => item.id === teamId), true);

    const legacyAssignment = await responseJson(
      await patchExecutionTask(
        new Request(`http://localhost/api/execution-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ assignedUserIds: [replacement.toString()] }),
        }),
        { params: Promise.resolve({ taskId: taskId.toString() }) },
      ),
    );
    assert.equal(legacyAssignment.item.teamId, null);
    assert.deepEqual(legacyAssignment.item.teamOverrides, []);
    assert.deepEqual(legacyAssignment.item.additionalTeamIds, []);
    assert.deepEqual(legacyAssignment.item.extraAssignments, []);
    assert.deepEqual(legacyAssignment.item.assignedUserIds, [replacement.toString()]);
    console.log("Execution teams route test passed.");
  } finally {
    const db = client.db();
    await Promise.all([
      db.collection("teams").deleteMany({ companyId }),
      db.collection("executionTasks").deleteMany({ _id: { $in: [taskId, conflictingTaskId, partialConflictTaskId] } }),
      db.collection("users").deleteMany({ _id: { $in: [actorId, memberA, memberB, replacement, additionalMemberA, additionalMemberB, extraWorker] } }),
      db.collection("companies").deleteOne({ _id: companyId }),
    ]).catch(() => {});
    await getMongoClient().then((shared) => shared.close()).catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("Execution teams route test failed:", error);
  process.exit(1);
});
