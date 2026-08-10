import "dotenv/config";
import { getDb, getMongoClient } from "@/lib/db";
import { buildDefaultOfferSignatureFields, ensureOfferSignatureIndexes } from "@/lib/offerSignatures";

async function main() {
  const db = await getDb();
  await ensureOfferSignatureIndexes(db);
  const plannings = db.collection("plannings");
  const modifiedByField: Record<string, number> = {};
  for (const [field, value] of Object.entries(buildDefaultOfferSignatureFields())) {
    const result = await plannings.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: value } },
    );
    modifiedByField[field] = result.modifiedCount;
  }
  console.log(JSON.stringify({ ok: true, modifiedByField }, null, 2));
}

main()
  .catch((error) => {
    console.error("Offer signature migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close().catch(() => undefined);
  });

