import "dotenv/config";
import { MongoClient } from "mongodb";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildInitialStageHistoryEntry(doc: any) {
  const createdAt =
    typeof doc?.createdAt?.toISOString === "function"
      ? doc.createdAt.toISOString()
      : safeString(doc?.createdAt) || new Date().toISOString();

  return {
    stage: safeString(doc?.commercial?.stage) || "lead",
    at: createdAt,
    by: safeString(doc?.createdByUserId) || null,
    byName: safeString(doc?.createdByName) || "unknown",
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const docs = await plannings
      .find(
        {
          $or: [
            { "commercial.stageHistory": { $exists: false } },
            { "commercial.stageHistory": null },
            { "commercial.stageHistory": { $size: 0 } },
          ],
        },
        {
          projection: {
            _id: 1,
            createdAt: 1,
            createdByUserId: 1,
            createdByName: 1,
            commercial: 1,
          },
        },
      )
      .toArray();

    if (!docs.length) {
      console.log("No plannings required stageHistory migration.");
      return;
    }

    const result = await plannings.bulkWrite(
      docs.map((doc: any) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              "commercial.stageHistory": [buildInitialStageHistoryEntry(doc)],
            },
          },
        },
      })),
    );

    console.log(`Migrated ${result.modifiedCount} planning(s) to stageHistory.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("migrate-stage-history failed:", error);
  process.exit(1);
});
