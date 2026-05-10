import "dotenv/config";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { buildExistingCompanyMigrationDefaults } from "../src/lib/subscription";

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const defaults = buildExistingCompanyMigrationDefaults(new Date());

    const result = await db.collection("companies").updateMany(
      {
        $or: [
          { plan: { $exists: false } },
          { subscriptionStatus: { $exists: false } },
          { validUntil: { $exists: false } },
          { maxUsers: { $exists: false } },
          { notes: { $exists: false } },
        ],
      },
      {
        $set: {
          plan: defaults.plan,
          subscriptionStatus: defaults.subscriptionStatus,
          validUntil: defaults.validUntil,
          maxUsers: defaults.maxUsers,
          notes: defaults.notes,
          updatedAt: new Date(),
        },
      },
    );

    console.log(
      `Backfill complete. matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("backfill-company-subscriptions failed:", error);
  process.exit(1);
});
