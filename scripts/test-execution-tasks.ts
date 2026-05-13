import "dotenv/config";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import {
  ensureExecutionTaskIndexes,
  ensureExecutionTasksForWonPlanning,
  getExecutionTasksCollection,
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

  const companyId = `test-company-${Date.now()}`;
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
      stage: "gewonnen",
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

    const allTasks = await getExecutionTasksCollection(db)
      .find({ companyId, projectId: planningId.toString() })
      .toArray();
    assert(allTasks.length === 2, `expected 2 execution tasks, got ${allTasks.length}`);

    const montageOpen = await getExecutionTasksCollection(db)
      .find({ companyId, track: "montage", stage: "offen" })
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
      db.collection("plannings").deleteOne({ _id: planningId }),
      db.collection("users").deleteMany({ _id: { $in: [montageUserId, elektroUserId] } }),
    ]);
  }
}

main().catch((error) => {
  console.error("Execution task smoke test failed:", error);
  process.exit(1);
});
