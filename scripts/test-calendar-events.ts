import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { DELETE as deleteCalendarEvent, PATCH as patchCalendarEvent } from "../src/app/api/calendar-events/[eventId]/route";
import { GET as getCalendarEvents, POST as postCalendarEvent } from "../src/app/api/calendar-events/route";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `session=${payload}.${sign(payload, secret)}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  const client = new MongoClient(uri);
  const companyObjectId = new ObjectId();
  const companyId = companyObjectId.toString();
  const userId = new ObjectId().toString();
  const assigneeId = new ObjectId().toString();
  const planningId = new ObjectId().toString();
  const taskId = new ObjectId().toString();
  const projectId = "PRJ-42";
  const sessionCookie = buildSessionCookie(
    {
      userId,
      id: userId,
      firstName: "Calendar",
      lastName: "Tester",
      name: "Calendar Tester",
      email: "calendar.tester@example.com",
      activeCompanyId: companyId,
      role: "admin",
    },
    secret,
  );

  try {
    await client.connect();
    const db = client.db();
    const now = new Date();

    await db.collection("companies").insertOne({
      _id: companyObjectId,
      name: "Calendar Test Company",
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("users").insertMany([
      {
        _id: new ObjectId(userId),
        firstName: "Calendar",
        lastName: "Tester",
        email: "calendar.tester@example.com",
        status: "active",
        memberships: [{ companyId: companyObjectId, role: "admin", status: "active" }],
      },
      {
        _id: new ObjectId(assigneeId),
        firstName: "Assignee",
        lastName: "User",
        email: "assignee@example.com",
        status: "active",
        memberships: [{ companyId: companyObjectId, role: "user", status: "active" }],
      },
    ]);

    const createRes = await postCalendarEvent(
      new Request("http://localhost/api/calendar-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          title: "Montage Vorbereitung",
          description: "Kurzbeschreibung fuer die Timeline",
          startDate: "2026-07-28",
          endDate: "2026-07-29",
          startTime: "08:30",
          endTime: "12:00",
          allDay: false,
          notes:
            '<p style="text-align:center">Bitte <strong>Material</strong> pruefen</p><script>alert(1)</script><span style="color:#ff0000">Rot</span>',
          assigneeUserIds: [assigneeId],
          linkedTaskId: taskId,
          linkedPlanningId: planningId,
          linkedProjectId: projectId,
          linkedCustomerId: "CUST-1",
        }),
      }),
    );
    assert.equal(createRes.status, 200);
    const createJson = await createRes.json();
    assert.equal(createJson.ok, true);
    assert.equal(createJson.item.title, "Montage Vorbereitung");
    assert.equal(createJson.item.description, "Kurzbeschreibung fuer die Timeline");
    assert.equal(createJson.item.subtitle, "Kurzbeschreibung fuer die Timeline");
    assert.equal(createJson.item.assigneeUserIds[0], assigneeId);
    assert.equal(createJson.item.assignees[0].fullName, "Assignee User");
    assert.equal(createJson.item.createdByName, "Calendar Tester");
    assert.equal(createJson.item.notes.includes("<script"), false);
    assert.equal(createJson.item.notes.includes('style="text-align:center"'), true);
    assert.equal(createJson.item.notes.includes("<strong>Material</strong>"), true);
    assert.equal(createJson.item.notes.includes('style="color:#ff0000"'), true);
    assert.equal(createJson.item.notesPreviewHtml, createJson.item.notes);

    const createdId = createJson.item.id;

    const listRes = await getCalendarEvents(
      new Request(
        `http://localhost/api/calendar-events?from=2026-07-29&to=2026-07-30&taskId=${taskId}&planningId=${planningId}&projectId=${projectId}&assigneeUserId=${assigneeId}`,
        {
          headers: { cookie: sessionCookie },
        },
      ),
    );
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.ok, true);
    assert.equal(listJson.items.length, 1);
    assert.equal(listJson.items[0].id, createdId);

    const patchRes = await patchCalendarEvent(
      new Request(`http://localhost/api/calendar-events/${createdId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          allDay: true,
          description: "Ganztag Subtitle",
          notes: '<h2 style="text-align:right">Ganztägiger Termin</h2><img src=x onerror=alert(1)>',
        }),
      }),
      { params: Promise.resolve({ eventId: createdId }) },
    );
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.item.allDay, true);
    assert.equal(patchJson.item.startTime, null);
    assert.equal(patchJson.item.endTime, null);
    assert.equal(patchJson.item.description, "Ganztag Subtitle");
    assert.equal(patchJson.item.subtitle, "Ganztag Subtitle");
    assert.equal(patchJson.item.notes.includes("<img"), false);
    assert.equal(patchJson.item.notes.includes('style="text-align:right"'), true);

    const deleteRes = await deleteCalendarEvent(
      new Request(`http://localhost/api/calendar-events/${createdId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ eventId: createdId }) },
    );
    assert.equal(deleteRes.status, 200);
    const deleteJson = await deleteRes.json();
    assert.equal(deleteJson.ok, true);

    const afterDeleteRes = await getCalendarEvents(
      new Request("http://localhost/api/calendar-events", {
        headers: { cookie: sessionCookie },
      }),
    );
    const afterDeleteJson = await afterDeleteRes.json();
    assert.equal(afterDeleteJson.items.length, 0);

    console.log("test-calendar-events: ok");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("test-calendar-events: failed", error);
  process.exitCode = 1;
});
