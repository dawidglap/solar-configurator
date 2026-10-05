import "dotenv/config";

import crypto from "node:crypto";
import { BSON, ObjectId, type Db, type Document } from "mongodb";

import { getDb, getMongoClient } from "@/lib/db";

const EXPECTED_DATABASE = "sola";
const APPLY = process.argv.includes("--apply");
const TARGETS = [
  { key: "ivan", company: "Test Ivan" },
  { key: "roberto", company: "Test Roberto" },
  { key: "marco", company: "Test Marco" },
] as const;
const SEED_PREFIX = "isolated-test-v1";

type PlannedDelete = {
  collection: string;
  id: ObjectId;
  currentCompanyId: string;
  expectedCompanyId: string;
  action: "delete";
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function idVariants(ids: ObjectId[]) {
  return [...ids, ...ids.map((id) => id.toHexString())];
}

async function demoFingerprint(db: Db, demoCompany: Document) {
  const companyId = demoCompany._id.toString();
  const variants = [companyId, demoCompany._id];
  const snapshot: Record<string, unknown> = { company: demoCompany };
  snapshot.users = await db.collection("users").find({ "memberships.companyId": { $in: variants } }).sort({ _id: 1 }).toArray();
  for (const name of ["customers", "catalogItems", "plannings", "planningFiles", "tasks", "executionTasks", "auftraege", "invoices", "teams"]) {
    snapshot[name] = await db.collection(name).find({ companyId: { $in: variants } }).sort({ _id: 1 }).toArray();
  }
  return crypto.createHash("sha256").update(BSON.EJSON.stringify(snapshot, { relaxed: false })).digest("hex");
}

async function addMatches(
  plan: PlannedDelete[],
  db: Db,
  collection: string,
  companyId: string,
  filter: Record<string, unknown>,
) {
  const docs = await db.collection(collection).find({ companyId, ...filter }, { projection: { _id: 1, companyId: 1 } }).toArray();
  for (const doc of docs) {
    plan.push({
      collection,
      id: doc._id,
      currentCompanyId: String(doc.companyId ?? ""),
      expectedCompanyId: companyId,
      action: "delete",
    });
  }
}

async function buildPlan(db: Db, companyId: string) {
  const plannings = await db.collection("plannings").find(
    { companyId },
    { projection: { _id: 1, companyId: 1, orderId: 1 } },
  ).toArray();
  const planningIds = plannings.map((doc) => doc._id);
  const planningValues = idVariants(planningIds);
  const orderIds = plannings.map((doc) => String(doc.orderId ?? "")).filter(Boolean);
  const plan: PlannedDelete[] = [];

  if (planningIds.length) {
    await addMatches(plan, db, "planningFiles", companyId, { planningId: { $in: planningValues } });
    await addMatches(plan, db, "executionTasks", companyId, { planningId: { $in: planningValues } });
    await addMatches(plan, db, "executionActivities", companyId, { planningId: { $in: planningValues } });
    await addMatches(plan, db, "tasks", companyId, { planningId: { $in: planningValues } });
    await addMatches(plan, db, "montages", companyId, { planningId: { $in: planningValues } });
    await addMatches(plan, db, "auftraege", companyId, { planningId: { $in: planningValues } });
  }
  if (orderIds.length) {
    await addMatches(plan, db, "invoices", companyId, { orderId: { $in: orderIds } });
    await addMatches(plan, db, "auftrag_steps_state", companyId, { orderId: { $in: orderIds } });
    await addMatches(plan, db, "auftrag_audit_logs", companyId, { orderId: { $in: orderIds } });
  }

  for (const planning of plannings) {
    plan.push({ collection: "plannings", id: planning._id, currentCompanyId: String(planning.companyId), expectedCompanyId: companyId, action: "delete" });
  }
  return plan;
}

async function main() {
  const db = await getDb();
  assert(db.databaseName === EXPECTED_DATABASE, `Database inatteso: ${db.databaseName}`);
  const demoCompany = await db.collection("companies").findOne({ name: "Demo Company" });
  assert(demoCompany, "Demo Company non trovata");
  const demoBefore = await demoFingerprint(db, demoCompany);

  const plans = [] as Array<{ company: string; companyId: string; records: PlannedDelete[] }>;
  for (const target of TARGETS) {
    const seedKey = `${SEED_PREFIX}:${target.key}`;
    const company = await db.collection("companies").findOne({ name: target.company, testSeedKey: seedKey });
    assert(company, `${target.company} non trovata o non appartenente al seed previsto`);
    const companyId = company._id.toString();
    const records = await buildPlan(db, companyId);
    assert(records.every((record) => record.currentCompanyId === companyId), `Record fuori scope rilevato per ${target.company}`);
    plans.push({ company: target.company, companyId, records });
  }

  console.log(JSON.stringify({ ok: true, mode: APPLY ? "apply" : "dry-run", database: db.databaseName, plans: plans.map((entry) => ({
    company: entry.company,
    companyId: entry.companyId,
    records: entry.records.map((record) => ({ collection: record.collection, recordId: record.id.toString(), currentCompanyId: record.currentCompanyId, expectedCompanyId: record.expectedCompanyId, proposedAction: record.action })),
  })) }, null, 2));
  if (!APPLY) return;

  for (const entry of plans) {
    const byCollection = new Map<string, ObjectId[]>();
    for (const record of entry.records) {
      const ids = byCollection.get(record.collection) ?? [];
      ids.push(record.id);
      byCollection.set(record.collection, ids);
    }
    for (const [collection, ids] of byCollection) {
      if (!ids.length) continue;
      const result = await db.collection(collection).deleteMany({
        _id: { $in: ids },
        companyId: entry.companyId,
      });
      assert(result.deletedCount === ids.length, `${collection}: eliminate ${result.deletedCount} righe su ${ids.length} per ${entry.company}`);
    }
  }

  for (const entry of plans) {
    const remaining = await buildPlan(db, entry.companyId);
    assert(remaining.length === 0, `Pulizia incompleta per ${entry.company}`);
    assert(await db.collection("plannings").countDocuments({ companyId: entry.companyId }) === 0, `${entry.company} contiene ancora progetti`);
    assert(await db.collection("tasks").countDocuments({ companyId: entry.companyId }) === 0, `${entry.company} contiene ancora task progetto`);
    assert(await db.collection("executionTasks").countDocuments({ companyId: entry.companyId }) === 0, `${entry.company} contiene ancora execution task`);
  }
  const demoAfter = await demoFingerprint(db, demoCompany);
  assert(demoAfter === demoBefore, "Demo Company modificata durante la pulizia");
  console.log(JSON.stringify({ ok: true, mode: "completed", database: db.databaseName, deleted: plans.map((entry) => ({ company: entry.company, count: entry.records.length })), demoCompanyUnchanged: true }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }));
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close().catch(() => undefined);
  });
