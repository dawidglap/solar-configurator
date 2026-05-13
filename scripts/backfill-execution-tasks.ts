import "dotenv/config";
import { getDb } from "@/lib/db";
import { backfillExecutionTasksForWonPlannings } from "@/lib/executionTasks";

async function main() {
  const db = await getDb();
  const result = await backfillExecutionTasksForWonPlannings(db, null);
  console.log(
    `Execution task backfill complete. processed=${result.processed} created=${result.created}`,
  );
}

main().catch((error) => {
  console.error("Execution task backfill failed:", error);
  process.exit(1);
});
