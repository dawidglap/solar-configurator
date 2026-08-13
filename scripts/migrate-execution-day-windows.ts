import "dotenv/config";
import { getMongoClient } from "@/lib/db";
import { ensureExecutionTaskIndexes } from "@/lib/executionTasks";
import { migrateExecutionExtraAssignmentDayWindows } from "@/lib/executionCrew";

async function main() {
  const client = await getMongoClient();
  try {
    const db = client.db();
    await ensureExecutionTaskIndexes(db);
    const result = await migrateExecutionExtraAssignmentDayWindows(db);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Execution day-window migration failed:", error);
  process.exit(1);
});
