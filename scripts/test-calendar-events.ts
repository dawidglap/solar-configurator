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
  const assigneeTwoId = new ObjectId().toString();
  const planningId = new ObjectId().toString();
  const customerId = new ObjectId().toString();
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

    await db.collection("customers").insertOne({
      _id: new ObjectId(customerId),
      companyId,
      firstName: "Linked",
      lastName: "Customer",
      name: "Linked Customer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("plannings").insertOne({
      _id: new ObjectId(planningId),
      companyId,
      customerId,
      title: "Linked Project",
      projectId,
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
      {
        _id: new ObjectId(assigneeTwoId),
        firstName: "Second",
        lastName: "Assignee",
        email: "assignee2@example.com",
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
          description:
            '<p>Rich <strong>Description</strong></p><script>alert(1)</script><span style="color:#ff0000">Rot</span>',
          startDate: "2026-07-28",
          endDate: "2026-07-29",
          startTime: "08:30",
          endTime: "12:00",
          allDay: false,
          notes: 'Kurz <strong>Hinweis</strong> mit <a href="https://example.com">Link</a>',
          assigneeUserIds: [userId, assigneeId],
          linkedTaskId: taskId,
          linkedPlanningId: planningId,
          linkedProjectId: projectId,
          linkedCustomerId: null,
        }),
      }),
    );
    assert.equal(createRes.status, 200);
    const createJson = await createRes.json();
    assert.equal(createJson.ok, true);
    assert.equal(createJson.item.title, "Montage Vorbereitung");
    assert.equal(createJson.item.description.includes("<script"), false);
    assert.equal(createJson.item.description.includes("<strong>Description</strong>"), true);
    assert.equal(createJson.item.description.includes('style="color:#ff0000"'), true);
    assert.equal(createJson.item.notes, "Kurz Hinweis mit Link");
    assert.equal(createJson.item.subtitle, "Kurz Hinweis mit Link");
    assert.deepEqual(createJson.item.assigneeUserIds, [userId, assigneeId]);
    assert.equal(createJson.item.linkedProjectId, projectId);
    assert.equal(createJson.item.linkedCustomerId, customerId);
    assert.equal(
      createJson.item.assignees.some((assignee: any) => assignee.id === assigneeId && assignee.fullName === "Assignee User"),
      true,
    );
    assert.equal(createJson.item.createdByName, "Calendar Tester");
    assert.equal(createJson.item.notesPreviewHtml, createJson.item.description);

    const notificationsAfterCreate = await db
      .collection("notifications")
      .find({ companyId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    assert.equal(notificationsAfterCreate.length, 1);
    assert.equal(String(notificationsAfterCreate[0]?.userId), assigneeId);
    assert.equal(notificationsAfterCreate[0]?.type, "calendar_event_assigned");
    assert.equal(notificationsAfterCreate[0]?.title, "Neuer Termin: Montage Vorbereitung");

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
          assigneeUserIds: [userId, assigneeId, assigneeTwoId],
          description:
            '<h2>Ganztägiger Termin</h2><img src=x onerror=alert(1)><mark style="background-color:#ffff00">Wichtig</mark>',
          notes: "<b>Ganztag Hinweis</b>",
        }),
      }),
      { params: Promise.resolve({ eventId: createdId }) },
    );
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.item.allDay, true);
    assert.equal(patchJson.item.startTime, null);
    assert.equal(patchJson.item.endTime, null);
    assert.equal(patchJson.item.description.includes("<img"), false);
    assert.equal(patchJson.item.description.includes("<h2>Ganztägiger Termin</h2>"), true);
    assert.equal(patchJson.item.description.includes('style="background-color:#ffff00"'), true);
    assert.equal(patchJson.item.notes, "Ganztag Hinweis");
    assert.equal(patchJson.item.subtitle, "Ganztag Hinweis");
    assert.equal(patchJson.item.notesPreviewHtml, patchJson.item.description);

    const notificationsAfterPatch = await db
      .collection("notifications")
      .find({ companyId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    assert.equal(notificationsAfterPatch.length, 2);
    assert.equal(String(notificationsAfterPatch[1]?.userId), assigneeTwoId);
    assert.equal(notificationsAfterPatch[1]?.type, "calendar_event_assigned");
    assert.equal(notificationsAfterPatch[1]?.meta?.eventId, createdId);

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
