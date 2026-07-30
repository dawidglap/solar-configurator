import "dotenv/config";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const invoices = db.collection("invoices");
    const now = new Date();

    const mahnungResult = await invoices.updateMany(
      {
        status: "mahnung",
        dunningLevel: { $ne: 1 },
      },
      {
        $set: {
          dunningLevel: 1,
          updatedAt: now,
        },
      },
    );

    const nonMahnungResult = await invoices.updateMany(
      {
        status: { $ne: "mahnung" },
        dunningLevel: { $ne: 0 },
      },
      {
        $set: {
          dunningLevel: 0,
          updatedAt: now,
        },
      },
    );

    console.log(
      `Invoice dunning backfill complete. mahnungMatched=${mahnungResult.matchedCount} mahnungModified=${mahnungResult.modifiedCount} nonMahnungMatched=${nonMahnungResult.matchedCount} nonMahnungModified=${nonMahnungResult.modifiedCount}`,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("backfill-invoice-dunning-status failed:", error);
  process.exit(1);
});
