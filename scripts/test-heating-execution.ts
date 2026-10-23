import "dotenv/config";

import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { GET as getExecutionTasks } from "@/app/api/execution-tasks/route";
import {
  GET as getExecutionTask,
  PATCH as patchExecutionTask,
} from "@/app/api/execution-tasks/[taskId]/route";
import { GET as getCalendarEvents } from "@/app/api/calendar-events/route";
import {
  DELETE as deleteCalendarEvent,
  PATCH as patchCalendarEvent,
} from "@/app/api/calendar-events/[eventId]/route";
import { getDb } from "@/lib/db";
import {
  ensureExecutionTasksForWonPlanning,
  getExecutionTasksCollection,
} from "@/lib/executionTasks";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `session=${payload}.${signature}`;
}

function apiRequest(
  cookie: string,
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
) {
  return new Request(`http://localhost${path}`, {
    method: init?.method ?? "GET",
    headers: {
      cookie,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function responseBody(response: Response) {
  return response.json().catch(() => null) as Promise<any>;
}

async function main() {
  const db = await getDb();
  const secret = process.env.SESSION_SECRET;
  assert(secret, "SESSION_SECRET is required");

  const companyA = new ObjectId();
  const companyB = new ObjectId();
  const customerId = new ObjectId().toString();
  const pvPlanningId = new ObjectId();
  const heatingPlanningId = new ObjectId();
  const legacyHeatingPlanningId = new ObjectId();
  const prematureHeatingPlanningId = new ObjectId();
  const heatingUserId = new ObjectId();
  const now = new Date();
  const companyBase = {
    plan: "starter",
    subscriptionStatus: "active",
    validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    maxUsers: 10,
    notes: "",
    pipelineStages: [{ key: "won", type: "won", label: "Gewonnen", order: 1 }],
    createdAt: now,
    updatedAt: now,
  };
  const planningBase = {
    companyId: companyA.toString(),
    customerId,
    commercial: { stage: "won" },
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("companies").insertMany([
    { _id: companyA, name: "Heating Execution Test A", ...companyBase },
    { _id: companyB, name: "Heating Execution Test B", ...companyBase },
  ]);
  await db.collection("plannings").insertMany([
    {
      _id: pvPlanningId,
      ...planningBase,
      projectType: "photovoltaic",
      planningNumber: `PV-EXEC-${Date.now()}`,
      orderId: "PV-TEST-1",
    },
    {
      _id: heatingPlanningId,
      ...planningBase,
      projectType: "heating",
      planningNumber: `HEAT-EXEC-${Date.now()}`,
      orderId: "HEAT-TEST-1",
    },
    {
      _id: legacyHeatingPlanningId,
      ...planningBase,
      projectType: "heating",
      planningNumber: `HEAT-LEGACY-${Date.now()}`,
      orderId: "HEAT-TEST-LEGACY",
    },
    {
      _id: prematureHeatingPlanningId,
      ...planningBase,
      projectType: "heating",
      planningNumber: `HEAT-NO-ORDER-${Date.now()}`,
    },
  ]);
  await db.collection("auftraege").insertMany([
    {
      companyId: companyA,
      planningId: heatingPlanningId,
      customerId: new ObjectId(customerId),
      projectType: "heating",
      orderId: "HEAT-TEST-1",
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId: companyA,
      planningId: legacyHeatingPlanningId,
      customerId: new ObjectId(customerId),
      projectType: "heating",
      orderId: "HEAT-TEST-LEGACY",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.collection("users").insertOne({
    _id: heatingUserId,
    email: `heating-execution-${Date.now()}@example.test`,
    firstName: "Heating",
    lastName: "Techniker",
    status: "active",
    executionRoles: ["heating"],
    memberships: [{ companyId: companyA.toString(), role: "installer", status: "active" }],
    createdAt: now,
    updatedAt: now,
  });

  try {
    const plannings = db.collection("plannings");
    const pvPlanning = await plannings.findOne({ _id: pvPlanningId });
    const heatingPlanning = await plannings.findOne({ _id: heatingPlanningId });
    const legacyHeatingPlanning = await plannings.findOne({ _id: legacyHeatingPlanningId });
    const prematureHeatingPlanning = await plannings.findOne({ _id: prematureHeatingPlanningId });

    const pvResult = await ensureExecutionTasksForWonPlanning(db, pvPlanning, null);
    assert(pvResult.created === 2, `PV expected 2 tasks, got ${pvResult.created}`);
    assert(
      pvResult.items.map((item) => item.track).sort().join(",") === "elektro,montage",
      "PV must create exactly montage + elektro",
    );

    const heatingResult = await ensureExecutionTasksForWonPlanning(db, heatingPlanning, null);
    assert(heatingResult.created === 1, `Heating expected 1 task, got ${heatingResult.created}`);
    assert(
      heatingResult.items.length === 1 && heatingResult.items[0].track === "heating",
      "Heating must create exactly the heating track",
    );
    assert(heatingResult.items[0].stage === "offen", "Heating initial stage must be offen");
    assert(heatingResult.items[0].scheduledStart === null, "Heating starts unscheduled");
    assert(Array.isArray(heatingResult.items[0].assignedUserIds), "Heating assignment shape missing");

    const retryResult = await ensureExecutionTasksForWonPlanning(db, heatingPlanning, null);
    assert(retryResult.created === 0, "Heating ensure retry must be idempotent");
    assert(retryResult.items.length === 1, "Heating retry must still return one task");

    const orderCountBefore = await db.collection("auftraege").countDocuments({
      companyId: companyA,
      planningId: legacyHeatingPlanningId,
    });
    const recoveryResult = await ensureExecutionTasksForWonPlanning(db, legacyHeatingPlanning, null);
    const orderCountAfter = await db.collection("auftraege").countDocuments({
      companyId: companyA,
      planningId: legacyHeatingPlanningId,
    });
    assert(recoveryResult.created === 1, "pre-4F Heating order must recover one task");
    assert(orderCountBefore === 1 && orderCountAfter === 1, "recovery must not recreate the Auftrag");

    const prematureResult = await ensureExecutionTasksForWonPlanning(
      db,
      prematureHeatingPlanning,
      null,
    );
    assert(prematureResult.created === 0, "Heating without canonical Auftrag must not create a task");

    const sameCustomerTasks = await getExecutionTasksCollection(db)
      .find({ companyId: companyA.toString(), customerId })
      .toArray();
    const tracksByProject = new Map(
      sameCustomerTasks.map((task) => [task.projectId, task.track]),
    );
    assert(tracksByProject.get(heatingPlanningId.toString()) === "heating", "Heating project leaked");
    assert(
      sameCustomerTasks.filter((task) => task.projectId === pvPlanningId.toString()).length === 2,
      "PV project was not isolated by projectId",
    );

    const taskId = heatingResult.items[0]._id.toString();
    const cookieA = buildSessionCookie(
      {
        isServiceSession: true,
        activeCompanyId: companyA.toString(),
        userId: heatingUserId.toString(),
        activeRole: "owner",
        name: "Heating Test Owner",
      },
      secret,
    );
    const cookieB = buildSessionCookie(
      {
        isServiceSession: true,
        activeCompanyId: companyB.toString(),
        activeRole: "owner",
        name: "Other Tenant",
      },
      secret,
    );

    const listResponse = await getExecutionTasks(
      apiRequest(cookieA, "/api/execution-tasks?track=heating"),
    );
    const listBody = await responseBody(listResponse);
    assert(listResponse.status === 200 && listBody.items.some((item: any) => item.id === taskId), "Heating task fetch failed");

    const itemResponse = await getExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`),
      { params: Promise.resolve({ taskId }) },
    );
    assert(itemResponse.status === 200, "Heating item fetch failed");
    const unscheduledEvents = await db.collection("calendar_events").countDocuments({
      companyId: companyA.toString(),
      managedSource: "execution_task",
      executionTrack: "heating",
      linkedTaskId: taskId,
    });
    assert(unscheduledEvents === 0, "unscheduled Heating task created a calendar event");

    const manualEventId = new ObjectId();
    await db.collection("calendar_events").insertOne({
      _id: manualEventId,
      companyId: companyA.toString(),
      title: "Manual event must survive",
      description: "manual",
      startDate: "2026-11-03",
      endDate: "2026-11-03",
      startTime: "10:00",
      endTime: "11:00",
      allDay: false,
      notes: "untouched",
      assigneeUserIds: [],
      assignees: [],
      linkedTaskId: taskId,
      linkedPlanningId: heatingPlanningId.toString(),
      linkedProjectId: heatingPlanningId.toString(),
      linkedCustomerId: customerId,
      createdAt: now,
      updatedAt: now,
    });
    const manualBefore = JSON.stringify(
      await db.collection("calendar_events").findOne({ _id: manualEventId }),
    );
    const invoiceCountBefore = await db.collection("invoices").countDocuments({
      companyId: companyA.toString(),
    });

    const scheduleBody = {
      assignedUserIds: [heatingUserId.toString()],
      scheduledStart: "2026-11-03T00:00:00.000Z",
      scheduledEnd: "2026-11-05T00:00:00.000Z",
      startTime: "08:00",
      endTime: "16:00",
      stage: "geplant",
      notes: "Heating lifecycle test",
    };
    const patchResponse = await patchExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: scheduleBody,
      }),
      { params: Promise.resolve({ taskId }) },
    );
    const patchBody = await responseBody(patchResponse);
    assert(patchResponse.status === 200, `Heating lifecycle PATCH failed: ${JSON.stringify(patchBody)}`);
    assert(patchBody.item.track === "heating", "PATCH changed Heating track");
    assert(patchBody.item.stage === "geplant", "Heating planned stage failed");
    assert(patchBody.item.assignedUserIds.includes(heatingUserId.toString()), "Heating assignment failed");
    assert(patchBody.item.scheduledStart, "Heating scheduling failed");
    assert(patchBody.calendarSync.items.length === 3, "Heating schedule must create one event per working day");

    let managedEvents = await db.collection("calendar_events")
      .find({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: taskId,
      })
      .sort({ occurrenceDate: 1 })
      .toArray();
    assert(managedEvents.length === 3, "Heating schedule did not persist three occurrences");
    assert(
      managedEvents.map((event) => event.occurrenceDate).join(",") ===
        "2026-11-03,2026-11-04,2026-11-05",
      "Heating working-day occurrences are incorrect",
    );
    assert(
      managedEvents.every(
        (event) =>
          event.startDate === event.endDate &&
          event.startTime === "08:00" &&
          event.endTime === "16:00" &&
          event.allDay === false &&
          event.executionStage === "geplant" &&
          event.assigneeUserIds.includes(heatingUserId.toString()) &&
          event.title.startsWith("Heizung · "),
      ),
      "Heating calendar projection fields are incorrect",
    );
    const managedCalendarList = await getCalendarEvents(
      apiRequest(cookieA, `/api/calendar-events?taskId=${taskId}`),
    );
    const managedCalendarBody = await responseBody(managedCalendarList);
    assert(
      managedCalendarList.status === 200 &&
        managedCalendarBody.items.filter((item: any) => item.readOnly).length === 3 &&
        managedCalendarBody.items.every(
          (item: any) => !item.readOnly || item.executionTrack === "heating",
        ),
      "calendar API did not expose managed Heating occurrences as read-only",
    );

    const repeatResponse = await patchExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: scheduleBody,
      }),
      { params: Promise.resolve({ taskId }) },
    );
    assert(repeatResponse.status === 200, "identical Heating schedule retry failed");
    assert(
      await db.collection("calendar_events").countDocuments({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: taskId,
      }) === 3,
      "identical Heating schedule retry created duplicates",
    );

    const rescheduleResponse = await patchExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: {
          scheduledStart: "2026-11-04T00:00:00.000Z",
          scheduledEnd: "2026-11-05T00:00:00.000Z",
          startTime: "09:00",
          endTime: "17:00",
          stage: "in_ausfuehrung",
        },
      }),
      { params: Promise.resolve({ taskId }) },
    );
    assert(rescheduleResponse.status === 200, "Heating reschedule failed");
    managedEvents = await db.collection("calendar_events")
      .find({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: taskId,
      })
      .sort({ occurrenceDate: 1 })
      .toArray();
    assert(
      managedEvents.length === 2 &&
        managedEvents.map((event) => event.occurrenceDate).join(",") === "2026-11-04,2026-11-05" &&
        managedEvents.every((event) => event.startTime === "09:00" && event.endTime === "17:00"),
      "Heating reschedule left stale or incorrect occurrences",
    );

    const managedEventId = managedEvents[0]._id.toString();
    const ownerCalendarPatch = await patchCalendarEvent(
      apiRequest(cookieA, `/api/calendar-events/${managedEventId}`, {
        method: "PATCH",
        body: { startDate: "2026-12-01", endDate: "2026-12-01" },
      }),
      { params: Promise.resolve({ eventId: managedEventId }) },
    );
    assert(ownerCalendarPatch.status === 409, "managed Heating event was editable from calendar API");
    const ownerCalendarDelete = await deleteCalendarEvent(
      apiRequest(cookieA, `/api/calendar-events/${managedEventId}`, { method: "DELETE" }),
      { params: Promise.resolve({ eventId: managedEventId }) },
    );
    assert(ownerCalendarDelete.status === 409, "managed Heating event was deletable from calendar API");

    const completionResponse = await patchExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: { stage: "abgeschlossen" },
      }),
      { params: Promise.resolve({ taskId }) },
    );
    assert(completionResponse.status === 200, "Heating completion failed");
    assert(
      await db.collection("calendar_events").countDocuments({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: taskId,
        executionStage: "abgeschlossen",
      }) === 2,
      "Heating completion must retain and mark calendar history",
    );

    const crossTenantGet = await getExecutionTask(
      apiRequest(cookieB, `/api/execution-tasks/${taskId}`),
      { params: Promise.resolve({ taskId }) },
    );
    assert(crossTenantGet.status === 404, "other tenant read Heating task");
    const crossTenantPatch = await patchExecutionTask(
      apiRequest(cookieB, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: { notes: "cross-tenant write" },
      }),
      { params: Promise.resolve({ taskId }) },
    );
    assert(crossTenantPatch.status === 404, "other tenant updated Heating task");
    const crossTenantCalendarList = await getCalendarEvents(
      apiRequest(cookieB, `/api/calendar-events?taskId=${taskId}`),
    );
    const crossTenantCalendarBody = await responseBody(crossTenantCalendarList);
    assert(
      crossTenantCalendarList.status === 200 && crossTenantCalendarBody.items.length === 0,
      "other tenant listed Heating calendar events",
    );
    const crossTenantCalendarPatch = await patchCalendarEvent(
      apiRequest(cookieB, `/api/calendar-events/${managedEventId}`, {
        method: "PATCH",
        body: { title: "cross-tenant" },
      }),
      { params: Promise.resolve({ eventId: managedEventId }) },
    );
    assert(crossTenantCalendarPatch.status === 404, "other tenant updated Heating calendar event");
    const crossTenantCalendarDelete = await deleteCalendarEvent(
      apiRequest(cookieB, `/api/calendar-events/${managedEventId}`, { method: "DELETE" }),
      { params: Promise.resolve({ eventId: managedEventId }) },
    );
    assert(crossTenantCalendarDelete.status === 404, "other tenant deleted Heating calendar event");

    const legacyTaskId = recoveryResult.items[0]._id.toString();
    await getExecutionTasksCollection(db).updateOne(
      { _id: recoveryResult.items[0]._id },
      {
        $set: {
          scheduledStart: new Date("2026-11-09T00:00:00.000Z"),
          scheduledEnd: new Date("2026-11-10T00:00:00.000Z"),
          workingDays: ["2026-11-09", "2026-11-10"],
          startTime: null,
          endTime: null,
          stage: "geplant",
        },
      },
    );
    const legacyRead = await getExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${legacyTaskId}`),
      { params: Promise.resolve({ taskId: legacyTaskId }) },
    );
    assert(legacyRead.status === 200, "pre-4F-C Heating task read-sync failed");
    assert(
      await db.collection("calendar_events").countDocuments({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: legacyTaskId,
      }) === 2,
      "pre-4F-C Heating task did not recover calendar occurrences exactly once",
    );
    for (const pvTask of pvResult.items) {
      await getExecutionTask(
        apiRequest(cookieA, `/api/execution-tasks/${pvTask._id.toString()}`),
        { params: Promise.resolve({ taskId: pvTask._id.toString() }) },
      );
    }
    assert(
      await db.collection("calendar_events").countDocuments({
        managedSource: "execution_task",
        linkedTaskId: { $in: pvResult.items.map((item) => item._id.toString()) },
      }) === 0,
      "PV task calendar behavior changed",
    );

    const unscheduleResponse = await patchExecutionTask(
      apiRequest(cookieA, `/api/execution-tasks/${taskId}`, {
        method: "PATCH",
        body: { scheduledStart: null, scheduledEnd: null, startTime: null, endTime: null },
      }),
      { params: Promise.resolve({ taskId }) },
    );
    assert(unscheduleResponse.status === 200, "Heating unschedule failed");
    assert(
      await db.collection("calendar_events").countDocuments({
        companyId: companyA.toString(),
        managedSource: "execution_task",
        executionTrack: "heating",
        linkedTaskId: taskId,
      }) === 0,
      "Heating unschedule left stale calendar appointments",
    );
    const manualAfter = JSON.stringify(
      await db.collection("calendar_events").findOne({ _id: manualEventId }),
    );
    assert(manualAfter === manualBefore, "Heating sync changed a manual calendar event");
    const invoiceCountAfter = await db.collection("invoices").countDocuments({
      companyId: companyA.toString(),
    });
    assert(invoiceCountAfter === invoiceCountBefore, "Heating calendar sync created invoice side effects");

    const montageCount = await db.collection("montages").countDocuments({
      companyId: { $in: [companyA, companyA.toString()] },
      planningId: { $in: [heatingPlanningId, heatingPlanningId.toString()] },
    });
    assert(montageCount === 0, "Heating created a legacy montages record");

    console.log("Heating execution integration test passed.");
  } finally {
    await Promise.all([
      db.collection("executionTasks").deleteMany({ companyId: companyA.toString() }),
      db.collection("executionActivities").deleteMany({ companyId: companyA.toString() }),
      db.collection("calendar_events").deleteMany({ companyId: companyA.toString() }),
      db.collection("auftraege").deleteMany({ companyId: companyA }),
      db.collection("plannings").deleteMany({
        _id: {
          $in: [
            pvPlanningId,
            heatingPlanningId,
            legacyHeatingPlanningId,
            prematureHeatingPlanningId,
          ],
        },
      }),
      db.collection("users").deleteOne({ _id: heatingUserId }),
      db.collection("companies").deleteMany({ _id: { $in: [companyA, companyB] } }),
    ]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Heating execution integration test failed:", error);
    process.exit(1);
  });
