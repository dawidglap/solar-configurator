import "dotenv/config";
import { getDb } from "@/lib/db";
import { ensureExecutionTaskIndexes, getExecutionTasksCollection } from "@/lib/executionTasks";
import { ensureTeamIndexes } from "@/lib/teams";

async function main() {
  const db = await getDb();
  await Promise.all([ensureExecutionTaskIndexes(db), ensureTeamIndexes(db)]);
  const tasks = getExecutionTasksCollection(db);
  const [teamIdResult, overridesResult] = await Promise.all([
    tasks.updateMany({ teamId: { $exists: false } }, { $set: { teamId: null } }),
    tasks.updateMany({ teamOverrides: { $exists: false } }, { $set: { teamOverrides: [] } }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        teamIdBackfilled: teamIdResult.modifiedCount,
        teamOverridesBackfilled: overridesResult.modifiedCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Execution team migration failed:", error);
  process.exit(1);
});
