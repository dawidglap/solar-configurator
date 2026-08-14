import "dotenv/config";
import { cleanupOrphanedCrewDeviationAbsences } from "@/lib/absences";
import { getMongoClient } from "@/lib/db";
import {
  migrateExecutionAssignedUserIds,
  migrateExecutionCrewDeviations,
} from "@/lib/executionCrew";
import {
  ensureExecutionTaskIndexes,
  migrateExecutionWorkingDays,
} from "@/lib/executionTasks";

async function main() {
  const client = await getMongoClient();
  try {
    const db = client.db();
    await ensureExecutionTaskIndexes(db);
    const crewDeviations = await migrateExecutionCrewDeviations(db);
    const workingDays = await migrateExecutionWorkingDays(db);
    const assignedUserIds = await migrateExecutionAssignedUserIds(db);
    const orphanedAbsences = await cleanupOrphanedCrewDeviationAbsences(db);
    console.log(JSON.stringify({
      ok: true,
      crewDeviations,
      workingDays,
      assignedUserIds,
      orphanedAbsences,
    }, null, 2));
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Execution conflict-hygiene migration failed:", error);
  process.exit(1);
});
