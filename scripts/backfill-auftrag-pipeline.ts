import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import {
  buildCompletedAuftragStepStates,
  buildInitialAuftragStepStates,
  ensureAuftragIndexes,
  ensureCompanyAuftragPipelineTemplate,
  getAuftraegeCollection,
} from "@/lib/auftragPipeline";

async function main() {
  const db = await getDb();
  await ensureAuftragIndexes(db);

  const companies = await db.collection("companies").find({}).project({ _id: 1 }).toArray();
  let seededTemplates = 0;
  let createdAuftraege = 0;

  for (const company of companies) {
    const companyId = company._id as ObjectId;
    const template = await ensureCompanyAuftragPipelineTemplate(db, companyId, {
      id: "backfill",
      fullName: "Backfill",
    });
    if ((template as any)?.updatedBy?.id === "backfill") {
      seededTemplates += 1;
    }

    const templateSteps = (template as any)?.steps ?? [];
    const montages = await db.collection("montages").find({ companyId }).toArray();
    for (const montage of montages) {
      const planningId = montage?.planningId instanceof ObjectId ? montage.planningId : null;
      if (!planningId) continue;

      const existing = await getAuftraegeCollection(db).findOne({
        companyId,
        planningId,
      });
      if (existing) continue;

      const completed = String(montage?.status || "").toLowerCase() === "completed";
      const actor = {
        id:
          montage?.createdBy instanceof ObjectId
            ? montage.createdBy.toString()
            : String(montage?.createdBy || ""),
        fullName: "Backfill",
      };
      const now = montage?.createdAt instanceof Date ? montage.createdAt : new Date();
      await getAuftraegeCollection(db).insertOne({
        companyId,
        planningId,
        montageId: montage?._id instanceof ObjectId ? montage._id : null,
        status: completed ? "abgeschlossen" : "aktiv",
        currentStepKey: completed
          ? templateSteps[templateSteps.length - 1]?.key || "projekt_abgeschlossen"
          : templateSteps[0]?.key || "projekt_geprueft",
        stepsState: completed
          ? buildCompletedAuftragStepStates(templateSteps, actor, now)
          : buildInitialAuftragStepStates(templateSteps, actor, now),
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
      });
      createdAuftraege += 1;
    }
  }

  console.log(JSON.stringify({ ok: true, seededTemplates, createdAuftraege }, null, 2));
}

main().catch((error) => {
  console.error("BACKFILL AUFTRAG PIPELINE ERROR:", error);
  process.exit(1);
});
