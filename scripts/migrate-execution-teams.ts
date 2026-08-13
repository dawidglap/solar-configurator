import "dotenv/config";
import { getMongoClient } from "@/lib/db";
import { ensureExecutionTaskIndexes, getExecutionTasksCollection } from "@/lib/executionTasks";
import { ensureTeamIndexes } from "@/lib/teams";
import {
  migrateExecutionCrewDeviations,
  migrateExecutionExtraAssignmentDayWindows,
} from "@/lib/executionCrew";

async function main() {
  const client = await getMongoClient();
  try {
    const db = client.db();
    await Promise.all([ensureExecutionTaskIndexes(db), ensureTeamIndexes(db)]);
    const tasks = getExecutionTasksCollection(db);
    const [teamIdResult, overridesResult, additionalTeamsResult, extraAssignmentsResult] = await Promise.all([
      tasks.updateMany({ teamId: { $exists: false } }, { $set: { teamId: null } }),
      tasks.updateMany({ teamOverrides: { $exists: false } }, { $set: { teamOverrides: [] } }),
      tasks.updateMany({ additionalTeamIds: { $exists: false } }, { $set: { additionalTeamIds: [] } }),
      tasks.updateMany({ extraAssignments: { $exists: false } }, { $set: { extraAssignments: [] } }),
    ]);
    const dayWindowsResult = await migrateExecutionExtraAssignmentDayWindows(db);
    const crewDeviationsResult = await migrateExecutionCrewDeviations(db);

    console.log(
      JSON.stringify(
        {
          ok: true,
          teamIdBackfilled: teamIdResult.modifiedCount,
          teamOverridesBackfilled: overridesResult.modifiedCount,
          additionalTeamIdsBackfilled: additionalTeamsResult.modifiedCount,
          extraAssignmentsBackfilled: extraAssignmentsResult.modifiedCount,
          extraAssignmentDayWindowsBackfilled: dayWindowsResult.modified,
          crewDeviationsBackfilled: crewDeviationsResult.modified,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Execution team migration failed:", error);
  process.exit(1);
});
