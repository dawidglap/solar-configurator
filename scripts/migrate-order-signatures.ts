import "dotenv/config";
import { getDb } from "@/lib/db";
import {
  buildDefaultOrderSignatureFields,
  ensureOrderSignatureIndexes,
  sha256,
} from "@/lib/orderSignatures";

async function main() {
  const db = await getDb();
  await ensureOrderSignatureIndexes(db);
  const plannings = db.collection("plannings");
  const defaults = buildDefaultOrderSignatureFields();
  const modifiedByField: Record<string, number> = {};

  for (const [field, value] of Object.entries(defaults)) {
    const result = await plannings.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: value } },
    );
    modifiedByField[field] = result.modifiedCount;
  }

  const activeWithoutHash = await plannings
    .find(
      {
        signatureStatus: { $in: ["sent", "viewed"] },
        signatureToken: { $type: "string", $ne: "" },
        $or: [
          { signatureTokenHash: null },
          { signatureTokenHash: "" },
          { signatureTokenHash: { $exists: false } },
        ],
      },
      { projection: { _id: 1, signatureToken: 1 } },
    )
    .toArray();
  let tokenHashesBackfilled = 0;
  if (activeWithoutHash.length) {
    const result = await plannings.bulkWrite(
      activeWithoutHash.map((planning) => ({
        updateOne: {
          filter: { _id: planning._id },
          update: { $set: { signatureTokenHash: sha256(String(planning.signatureToken)) } },
        },
      })),
      { ordered: false },
    );
    tokenHashesBackfilled = result.modifiedCount;
  }

  console.log(JSON.stringify({ ok: true, modifiedByField, tokenHashesBackfilled }, null, 2));
}

main().catch((error) => {
  console.error("Order signature migration failed:", error);
  process.exit(1);
});
