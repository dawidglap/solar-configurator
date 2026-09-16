/**
 * DESTRUCTIVE MAINTENANCE TOOL
 *
 * Dry-run (default):
 *   npx tsx scripts/reset-business-data.ts --all-tenants
 *   npx tsx scripts/reset-business-data.ts --company-id <companyId>
 *
 * Execute only after reviewing the dry-run:
 *   npx tsx scripts/reset-business-data.ts --all-tenants --confirm-reset-business-data
 *   npx tsx scripts/reset-business-data.ts --company-id <companyId> --confirm-reset-business-data
 *
 * This script never drops collections, indexes, or the database. It aborts when
 * an unknown collection is present so newly introduced data cannot be erased by
 * an old cleanup policy.
 */
import "dotenv/config";

import crypto from "node:crypto";
import { MongoClient, ObjectId, type Db, type Filter, type Document } from "mongodb";

const CONFIRM_FLAG = "--confirm-reset-business-data";
const ALL_TENANTS_FLAG = "--all-tenants";
const COMPANY_FLAG = "--company-id";

type Classification = "KEEP" | "REQUIRED INFRASTRUCTURE" | "DELETE";

const COLLECTION_POLICY: Record<string, Classification> = {
  // Explicit retention allowlist.
  users: "KEEP",
  customers: "KEEP",
  catalogItems: "KEEP",

  // Minimum identity/configuration required by retained records and login.
  companies: "REQUIRED INFRASTRUCTURE",
  counters: "REQUIRED INFRASTRUCTURE",
  auftrag_pipeline_templates: "REQUIRED INFRASTRUCTURE",
  "companyDocuments.files": "REQUIRED INFRASTRUCTURE",
  "companyDocuments.chunks": "REQUIRED INFRASTRUCTURE",
  password_reset_tokens: "REQUIRED INFRASTRUCTURE",
  password_reset_rate_limits: "REQUIRED INFRASTRUCTURE",

  // Business/transactional/history data.
  absences: "DELETE",
  auftraege: "DELETE",
  auftrag_audit_logs: "DELETE",
  auftrag_steps_state: "DELETE",
  calendar_events: "DELETE",
  executionActivities: "DELETE",
  executionCrewMutationLocks: "DELETE",
  executionTasks: "DELETE",
  geoAdminAddressCache: "DELETE",
  invoice_events: "DELETE",
  invoices: "DELETE",
  montages: "DELETE",
  notifications: "DELETE",
  planning_files: "DELETE",
  planningFiles: "DELETE",
  plannings: "DELETE",
  signatureEmailDeliveries: "DELETE",
  signatureRateLimits: "DELETE",
  snapshotCache: "DELETE",
  tasks: "DELETE",
  teams: "DELETE",
};

const DIRECT_COMPANY_COLLECTIONS = new Set([
  "absences",
  "auftraege",
  "auftrag_audit_logs",
  "auftrag_steps_state",
  "calendar_events",
  "executionActivities",
  "executionCrewMutationLocks",
  "executionTasks",
  "invoice_events",
  "invoices",
  "montages",
  "notifications",
  "planning_files",
  "planningFiles",
  "plannings",
  "signatureEmailDeliveries",
  "tasks",
  "teams",
]);

const RETAINED_COLLECTIONS = Object.entries(COLLECTION_POLICY)
  .filter(([, classification]) => classification !== "DELETE")
  .map(([name]) => name);

const DELETED_COLLECTIONS = Object.entries(COLLECTION_POLICY)
  .filter(([, classification]) => classification === "DELETE")
  .map(([name]) => name);

const BUSINESS_REFERENCE_KEY = /(?:project|planning|order|invoice|contract|offer|auftrag|task|montage)(?:id|ids)$/i;

type Scope =
  | { kind: "all-tenants" }
  | { kind: "company"; companyId: string; companyObjectId: ObjectId };

function parseArgs(argv: string[]) {
  const execute = argv.includes(CONFIRM_FLAG);
  const allTenants = argv.includes(ALL_TENANTS_FLAG);
  const companyIndex = argv.indexOf(COMPANY_FLAG);
  const companyId = companyIndex >= 0 ? String(argv[companyIndex + 1] ?? "").trim() : "";

  if (allTenants && companyId) {
    throw new Error(`Use either ${ALL_TENANTS_FLAG} or ${COMPANY_FLAG}, never both.`);
  }
  if (!allTenants && !companyId) {
    throw new Error(`Choose an explicit scope: ${ALL_TENANTS_FLAG} or ${COMPANY_FLAG} <id>.`);
  }
  if (companyId && !ObjectId.isValid(companyId)) {
    throw new Error(`Invalid ${COMPANY_FLAG} value.`);
  }

  const scope: Scope = allTenants
    ? { kind: "all-tenants" }
    : { kind: "company", companyId, companyObjectId: new ObjectId(companyId) };
  return { execute, scope };
}

function sanitizeTarget(uri: string) {
  const parsed = new URL(uri);
  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    databaseFromUri: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(driver default)",
    nodeEnv: process.env.NODE_ENV || "(unset)",
    vercelEnv: process.env.VERCEL_ENV || "(unset)",
  };
}

function hashIds(ids: unknown[]) {
  return crypto
    .createHash("sha256")
    .update(ids.map(String).sort().join("\n"))
    .digest("hex");
}

async function retainedFingerprint(db: Db, name: string) {
  const docs = await db.collection(name).find({}, { projection: { _id: 1 } }).toArray();
  return { count: docs.length, idSha256: hashIds(docs.map((doc) => doc._id)) };
}

function companyFilter(scope: Extract<Scope, { kind: "company" }>): Filter<Document> {
  return { companyId: { $in: [scope.companyId, scope.companyObjectId] } };
}

async function getPlanningIds(db: Db, scope: Extract<Scope, { kind: "company" }>) {
  const docs = await db
    .collection("plannings")
    .find(companyFilter(scope), { projection: { _id: 1 } })
    .toArray();
  return docs.flatMap((doc) => [doc._id, String(doc._id)]);
}

async function deletionFilter(db: Db, collectionName: string, scope: Scope): Promise<Filter<Document>> {
  if (scope.kind === "all-tenants") return {};
  if (DIRECT_COMPANY_COLLECTIONS.has(collectionName)) return companyFilter(scope);

  if (collectionName === "snapshotCache") {
    const planningIds = await getPlanningIds(db, scope);
    return { planningId: { $in: planningIds } };
  }

  // Global cache/rate-limit documents cannot be safely attributed to one tenant.
  // They are deleted only by an explicitly all-tenant reset.
  if (["geoAdminAddressCache", "signatureRateLimits"].includes(collectionName)) {
    return { _id: { $exists: false } };
  }

  throw new Error(`No tenant-safe deletion filter defined for ${collectionName}.`);
}

function collectReferencePaths(value: unknown, prefix = "", found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (value instanceof Date || value instanceof ObjectId || Buffer.isBuffer(value)) return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReferencePaths(entry, `${prefix}.${index}`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (BUSINESS_REFERENCE_KEY.test(key)) found.add(path);
    collectReferencePaths(child, path, found);
  }
  return found;
}

async function retainedReferenceAudit(db: Db) {
  const result: Record<string, string[]> = {};
  for (const collectionName of ["users", "customers", "catalogItems", "companies"]) {
    const docs = await db.collection(collectionName).find({}).toArray();
    const paths = new Set<string>();
    docs.forEach((doc) => collectReferencePaths(doc, "", paths));
    result[collectionName] = [...paths].sort();
  }
  return result;
}

async function inventory(db: Db, scope: Scope) {
  const existing = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(({ name }) => name)
    .sort();
  const unknown = existing.filter((name) => !COLLECTION_POLICY[name]);
  const rows = [];
  for (const name of existing) {
    const classification = COLLECTION_POLICY[name] ?? "UNKNOWN";
    const filter = classification === "DELETE" ? await deletionFilter(db, name, scope) : {};
    rows.push({
      collection: name,
      classification,
      databaseCount: await db.collection(name).countDocuments({}),
      affectedCount:
        classification === "DELETE" ? await db.collection(name).countDocuments(filter) : 0,
    });
  }
  return { existing, unknown, rows };
}

async function companyInventory(db: Db) {
  const companies = await db
    .collection("companies")
    .find({}, { projection: { name: 1, slug: 1, deletedAt: 1 } })
    .sort({ name: 1, _id: 1 })
    .toArray();
  return companies.map((company) => ({
    id: String(company._id),
    name: String(company.name ?? "(unnamed)"),
    slug: company.slug ? String(company.slug) : null,
    deleted: Boolean(company.deletedAt),
  }));
}

async function externalFileAudit(db: Db, scope: Scope) {
  const records = [];
  for (const name of ["planningFiles", "planning_files"]) {
    const filter = await deletionFilter(db, name, scope);
    const docs = await db
      .collection(name)
      .find(filter, { projection: { cloudinaryPublicId: 1 } })
      .toArray();
    records.push({
      collection: name,
      metadataRecords: docs.length,
      externalObjectReferences: docs.filter((doc) => doc.cloudinaryPublicId).length,
    });
  }
  return records;
}

async function main() {
  const { execute, scope } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not defined.");

  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db();
    const target = { ...sanitizeTarget(uri), resolvedDatabase: db.databaseName };
    const companies = await companyInventory(db);
    if (scope.kind === "company" && !companies.some((company) => company.id === scope.companyId)) {
      throw new Error(`Company ${scope.companyId} does not exist in ${db.databaseName}.`);
    }

    const before = await inventory(db, scope);
    const retainedBefore = Object.fromEntries(
      await Promise.all(
        RETAINED_COLLECTIONS
          .filter((name) => before.existing.includes(name))
          .map(async (name) => [name, await retainedFingerprint(db, name)] as const),
      ),
    );
    const references = await retainedReferenceAudit(db);
    const externalFiles = await externalFileAudit(db, scope);

    console.log(JSON.stringify({
      mode: execute ? "EXECUTE" : "DRY_RUN",
      target,
      backupOrPitrAvailable: "unknown (not exposed by the MongoDB application connection)",
      scope,
      companies,
      collectionInventory: before.rows,
      retainedFingerprintsBefore: retainedBefore,
      retainedBusinessReferencePaths: references,
      externalFileMetadata: externalFiles,
    }, null, 2));

    if (before.unknown.length > 0) {
      throw new Error(`Unknown collections require an explicit policy before cleanup: ${before.unknown.join(", ")}`);
    }
    if (!execute) {
      console.log(`\nDRY RUN ONLY. Add ${CONFIRM_FLAG} after reviewing this inventory.`);
      return;
    }

    const session = client.startSession();
    const deleted: Record<string, number> = {};
    try {
      await session.withTransaction(async () => {
        for (const name of DELETED_COLLECTIONS.filter((candidate) => before.existing.includes(candidate))) {
          const filter = await deletionFilter(db, name, scope);
          const result = await db.collection(name).deleteMany(filter, { session });
          deleted[name] = result.deletedCount;
        }
      });
    } finally {
      await session.endSession();
    }

    const after = await inventory(db, scope);
    const retainedAfter = Object.fromEntries(
      await Promise.all(
        RETAINED_COLLECTIONS
          .filter((name) => after.existing.includes(name))
          .map(async (name) => [name, await retainedFingerprint(db, name)] as const),
      ),
    );

    const changedRetained = Object.keys(retainedBefore).filter(
      (name) => JSON.stringify(retainedBefore[name]) !== JSON.stringify(retainedAfter[name]),
    );
    const remainingBusiness = after.rows.filter(
      (row) => row.classification === "DELETE" && row.affectedCount !== 0,
    );
    if (changedRetained.length > 0) {
      throw new Error(`Retained collection invariant failed: ${changedRetained.join(", ")}`);
    }
    if (remainingBusiness.length > 0) {
      throw new Error(`Business data remains in scope: ${remainingBusiness.map((row) => row.collection).join(", ")}`);
    }

    console.log(JSON.stringify({
      result: "CLEANUP_COMPLETE",
      deleted,
      retainedFingerprintsAfter: retainedAfter,
      collectionInventoryAfter: after.rows,
      invariants: {
        retainedCountsAndIdsUnchanged: true,
        businessCollectionsEmptyInScope: true,
        databaseDropped: false,
        collectionsOrIndexesDropped: false,
        externalObjectStorageDeleted: false,
      },
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("RESET_ABORTED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
