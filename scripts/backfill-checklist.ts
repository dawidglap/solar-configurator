import "dotenv/config";
import { MongoClient } from "mongodb";

const CHECKLIST_KEYS = [
  "projekt_geprueft",
  "baumeldung_eingereicht",
  "tag_eingereicht",
  "installationsanzeige_eingereicht",
  "pronovo_foerderung_angemeldet",
  "montage_geplant",
  "montage_ausgefuehrt",
  "elektroinstallation_geplant",
  "elektroinstallation_ausgefuehrt",
  "anlage_in_betrieb",
  "sina_kontrolle_abgeschlossen",
  "pronovo_foerderung_eingereicht",
  "unterlagen_an_ew_zugestellt",
  "technische_dokumentation_gesendet",
  "projekt_abgeschlossen",
] as const;

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildDefaultChecklist(updatedAt?: string | Date | null) {
  const at =
    typeof updatedAt === "string"
      ? updatedAt
      : updatedAt instanceof Date
        ? updatedAt.toISOString()
        : new Date().toISOString();

  return {
    items: CHECKLIST_KEYS.map((key) => ({
      key,
      done: false,
      doneAt: null,
      doneBy: null,
      doneByName: null,
      note: null,
    })),
    updatedAt: at,
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
            { checklist: { $exists: false } },
            { checklist: null },
            { "checklist.items": { $exists: false } },
            { "checklist.items": { $size: 0 } },
          ],
        },
        { projection: { _id: 1, createdAt: 1 } },
      )
      .toArray();

    if (!docs.length) {
      console.log("No plannings required checklist backfill.");
      return;
    }

    const result = await plannings.bulkWrite(
      docs.map((doc: any) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              checklist: buildDefaultChecklist(doc?.createdAt),
            },
          },
        },
      })),
    );

    console.log(
      `Backfilled checklist on ${result.modifiedCount} planning(s) out of ${docs.length}.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("backfill-checklist failed:", safeString((error as any)?.message) || error);
  process.exit(1);
});
