import "dotenv/config";
import { getDb } from "@/lib/db";
import { toCompanyObjectId } from "@/lib/orders";
import { buildPlanningDocumentPdf } from "@/lib/planningDocuments";
import {
  ensurePlanningFileIndexes,
  extractPlanningFileCustomerId,
  fetchPlanningFileBuffer,
  getPlanningFilesCollection,
  upsertManagedPlanningFile,
} from "@/lib/planningFiles";
import { safeString } from "@/lib/api-session";

async function buildAngebotSnapshotBuffer(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  planning: any;
  company: any;
  planningId: string;
}) {
  const files = getPlanningFilesCollection(args.db);
  const currentOfferFile = await files.findOne(
    {
      companyId: safeString(args.planning?.companyId),
      planningId: args.planningId,
      isDeleted: { $ne: true },
      mimeType: "application/pdf",
      $or: [
        { category: "offer" },
        { type: "angebot" },
      ],
    },
    { sort: { createdAt: -1, _id: -1 } },
  );

  if (currentOfferFile) {
    return fetchPlanningFileBuffer(currentOfferFile);
  }

  const { pdfBytes } = await buildPlanningDocumentPdf({
    db: args.db,
    planning: args.planning,
    company: args.company,
    session: {
      userId: null,
      activeCompanyId: safeString(args.planning?.companyId),
      activeRole: "admin",
      name: "System Backfill",
      email: "system@helionic.local",
    },
    documentType: "angebot",
  });

  return pdfBytes;
}

async function main() {
  const db = await getDb();
  await ensurePlanningFileIndexes(db);

  const plannings = db.collection("plannings");
  const companies = db.collection("companies");

  const docs = await plannings
    .find({
      orderStatus: "generated",
      companyId: { $exists: true, $ne: null },
      orderId: { $exists: true, $ne: null },
    })
    .toArray();

  let processed = 0;
  let auftragCreated = 0;
  let angebotSnapshotCreated = 0;
  let warnings = 0;

  for (const planning of docs) {
    processed += 1;
    const companyId = safeString(planning?.companyId);
    const planningId = safeString(planning?._id?.toString?.() ?? planning?._id);
    const orderId = safeString(planning?.orderId);
    if (!companyId || !planningId || !orderId) {
      warnings += 1;
      continue;
    }

    const company = await companies.findOne({ _id: toCompanyObjectId(companyId) });
    if (!company) {
      warnings += 1;
      continue;
    }

    const session = {
      userId: safeString(planning?.orderGeneratedByUserId?.toString?.() ?? planning?.orderGeneratedByUserId) || null,
      activeCompanyId: companyId,
      activeRole: "admin",
      name: safeString(planning?.orderGeneratedByName) || "System Backfill",
      email: "system@helionic.local",
    };

    try {
      const { pdfBytes } = await buildPlanningDocumentPdf({
        db,
        planning,
        company,
        session,
        documentType: "auftrag",
        orderId,
        orderGeneratedAt: planning?.orderGeneratedAt ?? new Date(),
      });

      const orderFile = await upsertManagedPlanningFile({
        db,
        companyId,
        planningId,
        category: "auftrag",
        title: `Auftrag ${orderId}`,
        originalFileName: `auftrag-${orderId}.pdf`,
        mimeType: "application/pdf",
        buffer: pdfBytes,
        customerId: extractPlanningFileCustomerId(planning),
        session,
      });
      if (!orderFile.reused) {
        auftragCreated += 1;
      }

      const angebotSnapshotBuffer = await buildAngebotSnapshotBuffer({
        db,
        planning,
        company,
        planningId,
      });

      const angebotSnapshot = await upsertManagedPlanningFile({
        db,
        companyId,
        planningId,
        category: "angebot_snapshot",
        title: `Angebot Snapshot — ${orderId}`,
        originalFileName: `angebot-snapshot-${orderId}.pdf`,
        mimeType: "application/pdf",
        buffer: angebotSnapshotBuffer,
        customerId: extractPlanningFileCustomerId(planning),
        session,
      });
      if (!angebotSnapshot.reused) {
        angebotSnapshotCreated += 1;
      }

      await plannings.updateOne(
        { _id: planning._id, companyId },
        {
          $set: {
            orderSnapshotFileId: orderFile.doc?._id ?? planning?.orderSnapshotFileId ?? null,
            angebotSnapshotFileId:
              angebotSnapshot.doc?._id ?? planning?.angebotSnapshotFileId ?? null,
            updatedAt: new Date(),
          },
        },
      );
    } catch (error) {
      warnings += 1;
      console.error(`Backfill failed for planning ${planningId}:`, error);
    }
  }

  console.log(
    `Order file backfill complete. processed=${processed} auftragCreated=${auftragCreated} angebotSnapshotCreated=${angebotSnapshotCreated} warnings=${warnings}`,
  );
}

main().catch((error) => {
  console.error("Order file backfill failed:", error);
  process.exit(1);
});
