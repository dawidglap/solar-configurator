import assert from "node:assert/strict";
import "dotenv/config";
import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");
const EXPECTED_DB = "sola";
const ACTIVE_COMPANY_FILTER = {
  $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
};

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    assert.equal(
      db.databaseName,
      EXPECTED_DB,
      `STOP: expected database ${EXPECTED_DB}, got ${db.databaseName}`,
    );

    const companies = db.collection("companies");
    const snapshot = await companies
      .find(ACTIVE_COMPANY_FILTER)
      .project({ name: 1 })
      .sort({ _id: 1 })
      .toArray();
    const targets = snapshot.map((company) => ({
      _id: String(company._id),
      name: typeof company.name === "string" ? company.name : "",
    }));

    console.log(JSON.stringify({ database: db.databaseName, apply: APPLY, count: targets.length, targets }, null, 2));
    if (!APPLY) return;

    const verification = await companies
      .find(ACTIVE_COMPANY_FILTER)
      .project({ _id: 1 })
      .sort({ _id: 1 })
      .toArray();
    const snapshotIds = targets.map((target) => target._id);
    const verificationIds = verification.map((company) => String(company._id));
    assert.deepEqual(verificationIds, snapshotIds, "STOP: target companies changed between read and write");

    const now = new Date();
    const auditEvent = {
      at: now.toISOString(),
      by: null,
      byName: "production migration",
      reason: "existing_company_permanent_access",
      source: "vieon_existing_company_migration",
      changes: { subscriptionStatus: "active", validUntil: null },
    };
    const result = await companies.updateMany(
      { _id: { $in: snapshot.map((company) => company._id) }, ...ACTIVE_COMPANY_FILTER },
      {
        $set: { subscriptionStatus: "active", validUntil: null, updatedAt: now },
        $push: { subscriptionHistory: auditEvent },
      } as any,
    );
    assert.equal(result.matchedCount, targets.length, "STOP: write target count changed unexpectedly");

    const remaining = await companies.countDocuments({
      _id: { $in: snapshot.map((company) => company._id) },
      $or: [{ subscriptionStatus: { $ne: "active" } }, { validUntil: { $ne: null } }],
    });
    assert.equal(remaining, 0, "Migration verification failed");
    console.log(JSON.stringify({ ok: true, matched: result.matchedCount, modified: result.modifiedCount }));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
