import "dotenv/config";
import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const tasks = db.collection("tasks");

    const docs = await tasks
      .find(
        {
          assignedToUserId: { $type: "string", $ne: "" },
          $or: [
            { assignedToUserIds: { $exists: false } },
            { assignedToUserIds: null },
            { assignedToUserIds: { $size: 0 } },
          ],
        },
        { projection: { _id: 1, assignedToUserId: 1 } },
      )
      .toArray();

    if (!docs.length) {
      console.log("No tasks required multi-assignee migration.");
      return;
    }

    const result = await tasks.bulkWrite(
      docs.map((doc: any) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              assignedToUserIds: [String(doc.assignedToUserId)],
            },
          },
        },
      })),
    );

    console.log(
      `Migrated ${result.modifiedCount} task(s) to assignedToUserIds.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("migrate-tasks-multiassignee failed:", error);
  process.exit(1);
});
