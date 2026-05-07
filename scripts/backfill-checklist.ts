import "dotenv/config";
import { MongoClient } from "mongodb";

const CHECKLIST_KEYS = [
  "projekt_geprueft",
  "baumeldung_eingereicht",
  "baumeldung_genehmigt",
  "netzanschlussgesuch_eingereicht",
  "netzanschlussgesuch_genehmigt",
  "material_bestellt",
  "material_geliefert",
  "montage_geplant",
  "montage_durchgefuehrt",
  "elektroinstallation_durchgefuehrt",
  "inbetriebnahme",
  "abnahme_kunde",
  "abnahme_ewz",
  "schlussrechnung_versendet",
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
      .find({}, { projection: { _id: 1, createdAt: 1, checklist: 1 } })
      .toArray();

    const docsNeedingBackfill = docs.filter((doc: any) => {
      const items = Array.isArray(doc?.checklist?.items) ? doc.checklist.items : [];
      if (!items.length) return true;
      if (items.length !== CHECKLIST_KEYS.length) return true;
      return CHECKLIST_KEYS.some((key) => {
        return !items.some((item: any) => safeString(item?.key) === key);
      });
    });

    if (!docsNeedingBackfill.length) {
      console.log("No plannings required checklist backfill.");
      return;
    }

    const result = await plannings.bulkWrite(
      docsNeedingBackfill.map((doc: any) => ({
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
      `Backfilled checklist on ${result.modifiedCount} planning(s) out of ${docsNeedingBackfill.length}.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("backfill-checklist failed:", safeString((error as any)?.message) || error);
  process.exit(1);
});
