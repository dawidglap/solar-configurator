import "dotenv/config";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import {
  auditSnowProtectionDuplicates,
  ensureCompanySnowProtectionCatalogItem,
  ensureSnowProtectionUniqueIndex,
  findSnowProtectionCatalogItem,
  SNOW_PROTECTION_INDEX_NAME,
} from "../src/lib/snowProtectionCatalog";

function readFlag(name: string) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "Missing MONGODB_URI");

  const apply = process.argv.includes("--apply");
  const backupConfirmed = process.argv.includes("--backup-confirmed");
  const confirmedDatabase = readFlag("--confirm-db");
  const parsedUri = new URL(uri);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

  try {
    await client.connect();
    const db = client.db();
    const target = {
      host: parsedUri.hostname,
      database: db.databaseName,
    };

    const companies = await db
      .collection("companies")
      .find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
      .project({ _id: 1, name: 1 })
      .sort({ _id: 1 })
      .toArray();
    const duplicates = await auditSnowProtectionDuplicates(db);
    const indexes = await db.collection("catalogItems").indexes();
    const uniqueIndexPresent = indexes.some(
      (index) => index.name === SNOW_PROTECTION_INDEX_NAME && index.unique === true,
    );

    const missingCompanyIds: string[] = [];
    let alreadyPresent = 0;
    for (const company of companies) {
      const existing = await findSnowProtectionCatalogItem(db, company._id);
      if (existing) alreadyPresent += 1;
      else missingCompanyIds.push(String(company._id));
    }

    const report = {
      mode: apply ? "apply" : "dry-run",
      target,
      backup: apply
        ? "confirmed-by-operator"
        : "not-verifiable-via-application-credentials; confirmation required before apply",
      companiesScanned: companies.length,
      alreadyPresent,
      toCreate: missingCompanyIds.length,
      duplicateCompanies: duplicates.length,
      duplicates,
      uniqueIndexPresent,
    };

    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    assert.equal(
      confirmedDatabase,
      db.databaseName,
      `Refusing writes: pass --confirm-db=${db.databaseName}`,
    );
    assert.ok(
      backupConfirmed,
      "Refusing writes: verify a current backup and pass --backup-confirmed",
    );
    assert.equal(
      duplicates.length,
      0,
      "Refusing writes: resolve reported duplicate products manually first",
    );

    await ensureSnowProtectionUniqueIndex(db);
    let created = 0;
    for (const companyId of missingCompanyIds) {
      const result = await ensureCompanySnowProtectionCatalogItem(db, companyId);
      if (result.created) created += 1;
    }

    console.log(
      JSON.stringify(
        {
          ...report,
          uniqueIndexPresent: true,
          created,
          status: "applied",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("SNOW PROTECTION CATALOG BACKFILL FAILED:", error);
  process.exitCode = 1;
});
