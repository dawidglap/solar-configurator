import "dotenv/config";
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { buildUserProfileBackfillPatch } from "../src/lib/userProfileBackfill";

const FORCE = process.argv.includes("--force");

function membershipForCompany(user: any, companyId: ObjectId) {
  return (Array.isArray(user?.memberships) ? user.memberships : []).find(
    (membership: any) => String(membership?.companyId ?? "") === companyId.toHexString(),
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const companies = await db.collection("companies").find({
      $or: [
        { slug: /^demo-company$/i },
        { name: /^demo(?:-|\s+)company$/i },
      ],
      deletedAt: { $exists: false },
    }).limit(2).toArray();

    if (companies.length === 0) throw new Error('Firma "demo-company" wurde nicht gefunden.');
    if (companies.length > 1) throw new Error('Mehrere Firmen passen auf "demo-company"; Backfill abgebrochen.');

    const company = companies[0];
    const companyId = company._id as ObjectId;
    const companyIdString = companyId.toHexString();
    const users = await db.collection("users").find({
      memberships: {
        $elemMatch: { companyId: { $in: [companyId, companyIdString] } },
      },
    }).sort({ firstName: 1, lastName: 1, email: 1, _id: 1 }).toArray();

    let updated = 0;
    for (let position = 0; position < users.length; position += 1) {
      const user = users[position];
      const membership = membershipForCompany(user, companyId);
      const patch = buildUserProfileBackfillPatch({
        user,
        membership,
        companyName: String(company.name ?? "Demo Company").trim() || "Demo Company",
        index: position + 1,
        force: FORCE,
      });
      if (Object.keys(patch).length === 0) continue;

      const result = await db.collection("users").updateOne(
        { _id: user._id },
        { $set: { ...patch, updatedAt: new Date() } },
      );
      if (result.modifiedCount > 0) updated += 1;
    }

    console.log(
      `User profile backfill complete. updated=${updated} skipped=${users.length - updated} total=${users.length}`,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("User profile backfill failed:", error);
  process.exitCode = 1;
});
