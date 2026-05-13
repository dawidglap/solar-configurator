import "dotenv/config";
import { getDb } from "@/lib/db";
import { migrateMontagesToExecutionTasks } from "@/lib/executionTasks";

async function main() {
  const db = await getDb();
  const result = await migrateMontagesToExecutionTasks(db, null);
  console.log(
    `Montage migration complete. processed=${result.processed} created=${result.created} skipped=${result.skipped}`,
  );
}

main().catch((error) => {
  console.error("Montage migration failed:", error);
  process.exit(1);
});
