import "dotenv/config";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import {
  backfillExecutionTasksForWonPlannings,
  ensureExecutionTaskIndexes,
  ensureExecutionTasksForWonPlanning,
  getExecutionTasksCollection,
  isPlanningWon,
  validateExecutionAssignees,
} from "@/lib/executionTasks";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const db = await getDb();
  await ensureExecutionTaskIndexes(db);

  const companyId = new ObjectId().toString();
  const planningId = new ObjectId();
  const montageUserId = new ObjectId();
  const elektroUserId = new ObjectId();

  const planningDoc = {
    _id: planningId,
    companyId,
    customerId: new ObjectId().toString(),
    title: "Execution Task Smoke Test",
    planningNumber: `TEST-${Date.now()}`,
    commercial: {
      stage: "won",
    },
    summary: {
      customerName: "Smoke Test Kunde",
    },
    data: {
      profile: {
        buildingStreet: "Testweg",
        buildingStreetNo: "12",
        buildingZip: "8000",
        buildingCity: "Zürich",
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.collection("plannings").insertOne(planningDoc);
  const gewonnenPlanningId = new ObjectId();
  const backfillPlanningId = new ObjectId();
  await db.collection("plannings").insertMany([
    {
      _id: gewonnenPlanningId,
      companyId,
      customerId: new ObjectId().toString(),
      title: "Execution Task Kompatibilität",
      planningNumber: `TEST-GEW-${Date.now()}`,
      commercial: { stage: "gewonnen" },
      summary: { customerName: "Gewonnen Kunde" },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: backfillPlanningId,
      companyId,
      customerId: new ObjectId().toString(),
      title: "Execution Task Backfill",
      planningNumber: `TEST-BACKFILL-${Date.now()}`,
      commercial: { stage: "won" },
      summary: { customerName: "Backfill Kunde" },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await db.collection("companies").insertOne({
    _id: new ObjectId(companyId),
    name: "Execution Test Company",
    pipelineStages: [
      { key: "lead", type: "open", label: "Lead", color: "hsl(210 80% 58%)", order: 0 },
      { key: "won", type: "won", label: "Gewonnen", color: "hsl(160 60% 45%)", order: 1 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("users").insertMany([
    {
      _id: montageUserId,
      email: "montage-smoke@example.com",
      status: "active",
      firstName: "Montage",
      lastName: "User",
      executionRoles: ["montage"],
      memberships: [{ companyId, role: "installer", status: "active" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: elektroUserId,
      email: "elektro-smoke@example.com",
      status: "active",
      firstName: "Elektro",
      lastName: "User",
      executionRoles: ["elektro"],
      memberships: [{ companyId, role: "installer", status: "active" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  try {
    assert(await isPlanningWon(db, planningDoc), "expected planning with stage=won to be treated as won");
    const first = await ensureExecutionTasksForWonPlanning(db, planningDoc, {
      userId: montageUserId.toString(),
      activeCompanyId: companyId,
    } as any);
    assert(first.created === 2, `expected 2 created tasks, got ${first.created}`);

    const second = await ensureExecutionTasksForWonPlanning(db, planningDoc, {
      userId: montageUserId.toString(),
      activeCompanyId: companyId,
    } as any);
    assert(second.created === 0, `expected idempotent 0 created tasks, got ${second.created}`);

    const compatibility = await ensureExecutionTasksForWonPlanning(
      db,
      await db.collection("plannings").findOne({ _id: gewonnenPlanningId }),
      {
        userId: montageUserId.toString(),
        activeCompanyId: companyId,
      } as any,
    );
    assert(
      compatibility.created === 2,
      `expected 2 created tasks for stage=gewonnen, got ${compatibility.created}`,
    );

    const backfill = await backfillExecutionTasksForWonPlannings(db, {
      userId: montageUserId.toString(),
      activeCompanyId: companyId,
    } as any);
    assert(backfill.created >= 2, `expected backfill to create at least 2 tasks, got ${backfill.created}`);

    const allTasks = await getExecutionTasksCollection(db)
      .find({ companyId, projectId: planningId.toString() })
      .toArray();
    assert(allTasks.length === 2, `expected 2 execution tasks, got ${allTasks.length}`);

    const backfillTasks = await getExecutionTasksCollection(db)
      .find({ companyId, projectId: backfillPlanningId.toString() })
      .toArray();
    assert(backfillTasks.length === 2, `expected 2 backfill tasks, got ${backfillTasks.length}`);

    const montageOpen = await getExecutionTasksCollection(db)
      .find({ companyId, projectId: planningId.toString(), track: "montage", stage: "offen" })
      .toArray();
    assert(montageOpen.length === 1, `expected 1 montage/offen task, got ${montageOpen.length}`);

    const validMontageAssignment = await validateExecutionAssignees(
      db,
      companyId,
      "montage",
      [montageUserId.toString()],
    );
    assert(
      validMontageAssignment.assignedUserIds.length === 1,
      "expected one valid montage assignee",
    );

    let mismatchRejected = false;
    try {
      await validateExecutionAssignees(
        db,
        companyId,
        "montage",
        [elektroUserId.toString()],
      );
    } catch {
      mismatchRejected = true;
    }
    assert(mismatchRejected, "expected montage assignment to reject elektro-only user");

    console.log("Execution task smoke test passed.");
  } finally {
    await Promise.all([
      db.collection("executionTasks").deleteMany({ companyId }),
      db.collection("plannings").deleteMany({ _id: { $in: [planningId, gewonnenPlanningId, backfillPlanningId] } }),
      db.collection("companies").deleteOne({ _id: new ObjectId(companyId) }),
      db.collection("users").deleteMany({ _id: { $in: [montageUserId, elektroUserId] } }),
    ]);
  }
}

main().catch((error) => {
  console.error("Execution task smoke test failed:", error);
  process.exit(1);
});
