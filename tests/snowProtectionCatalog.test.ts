import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId, type Db } from "mongodb";
import {
  auditSnowProtectionDuplicates,
  buildSnowProtectionCatalogItem,
  canDeleteCatalogItem,
  ensureCompanySnowProtectionCatalogItem,
  ensureSnowProtectionUniqueIndex,
  isSnowProtectionRoleAssignmentBlocked,
  preserveSnowProtectionPlannerRole,
  preserveSnowProtectionTechnicalFields,
  SNOW_PROTECTION_CATEGORY,
  SNOW_PROTECTION_INDEX_NAME,
  SNOW_PROTECTION_PLANNER_ROLE,
} from "../src/lib/snowProtectionCatalog";

type Row = Record<string, any> & { _id: ObjectId };

function valueAt(row: Record<string, any>, path: string) {
  return path.split(".").reduce<any>((value, key) => value?.[key], row);
}

function sameValue(left: any, right: any) {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matches(row: Row, filter: Record<string, any>) {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = valueAt(row, path);
    if (expected && typeof expected === "object" && "$in" in expected) {
      return expected.$in.some((candidate: any) => sameValue(actual, candidate));
    }
    if (expected && typeof expected === "object" && "$ne" in expected) {
      return !sameValue(actual, expected.$ne);
    }
    return sameValue(actual, expected);
  });
}

class FakeCatalogCollection {
  rows: Row[];
  indexesCreated: Array<{ name?: string; unique?: boolean }> = [];
  uniqueEnabled = false;

  constructor(seed: Array<Record<string, any>> = []) {
    this.rows = seed.map((row) => ({ _id: row._id ?? new ObjectId(), ...row })) as Row[];
  }

  find(filter: Record<string, any>) {
    return {
      toArray: async () => this.rows.filter((row) => matches(row, filter)).map((row) => ({ ...row })),
    };
  }

  async findOne(filter: Record<string, any>) {
    return this.rows.find((row) => matches(row, filter)) ?? null;
  }

  async updateOne(
    filter: Record<string, any>,
    update: { $setOnInsert?: Record<string, any>; $set?: Record<string, any> },
    options: { upsert?: boolean } = {},
  ) {
    await Promise.resolve();
    const existing = this.rows.find((row) => matches(row, filter));
    if (existing) {
      if (update.$set) Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: update.$set ? 1 : 0, upsertedCount: 0 };
    }
    if (!options.upsert || !update.$setOnInsert) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    const inserted = { _id: new ObjectId(), ...update.$setOnInsert } as Row;
    const conflicting = this.rows.some(
      (row) =>
        row.companyId === inserted.companyId &&
        valueAt(row, "metadata.plannerRole") === valueAt(inserted, "metadata.plannerRole"),
    );
    if (this.uniqueEnabled && conflicting) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    this.rows.push(inserted);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  }

  async deleteOne(filter: Record<string, any>) {
    const index = this.rows.findIndex((row) => matches(row, filter));
    if (index < 0) return { deletedCount: 0 };
    this.rows.splice(index, 1);
    return { deletedCount: 1 };
  }

  async createIndex(_keys: Record<string, number>, options: { name?: string; unique?: boolean }) {
    this.indexesCreated.push(options);
    this.uniqueEnabled = options.unique === true;
    return options.name ?? "index";
  }
}

function fakeDb(seed: Array<Record<string, any>> = []) {
  const catalog = new FakeCatalogCollection(seed);
  return {
    catalog,
    db: {
      collection(name: string) {
        assert.equal(name, "catalogItems");
        return catalog;
      },
    } as unknown as Db,
  };
}

test("1. new company receives the canonical Schneefang product", async () => {
  const { db, catalog } = fakeDb();
  await ensureSnowProtectionUniqueIndex(db);
  const result = await ensureCompanySnowProtectionCatalogItem(db, new ObjectId());
  assert.equal(result.created, true);
  assert.equal(catalog.rows.length, 1);
  assert.equal(result.item.name, "Schneefang");
  assert.equal(result.item.unit, "m");
  assert.equal(result.item.category, SNOW_PROTECTION_CATEGORY);
  assert.equal(result.item.priceNet, 0);
  assert.equal(result.item.metadata.plannerRole, SNOW_PROTECTION_PLANNER_ROLE);
  assert.equal(catalog.indexesCreated[0]?.name, SNOW_PROTECTION_INDEX_NAME);
  assert.equal(catalog.indexesCreated[0]?.unique, true);
});

test("2. existing company missing the product is backfilled", async () => {
  const { db } = fakeDb([{ companyId: "company-a", name: "Ordinary" }]);
  const result = await ensureCompanySnowProtectionCatalogItem(db, "company-a");
  assert.equal(result.created, true);
  assert.equal(result.item.companyId, "company-a");
});

test("3. configured product is preserved without duplicates", async () => {
  const configured = { ...buildSnowProtectionCatalogItem("company-a"), priceNet: 40 };
  const { db, catalog } = fakeDb([configured]);
  const result = await ensureCompanySnowProtectionCatalogItem(db, "company-a");
  assert.equal(result.created, false);
  assert.equal(result.item.priceNet, 40);
  assert.equal(catalog.rows.length, 1);
});

test("4. repeated backfill is idempotent", async () => {
  const { db, catalog } = fakeDb();
  await ensureCompanySnowProtectionCatalogItem(db, "company-a");
  await ensureCompanySnowProtectionCatalogItem(db, "company-a");
  assert.equal(catalog.rows.length, 1);
});

test("5. concurrent initialization creates one product", async () => {
  const { db, catalog } = fakeDb();
  await ensureSnowProtectionUniqueIndex(db);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => ensureCompanySnowProtectionCatalogItem(db, "company-a")),
  );
  assert.equal(catalog.rows.length, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test("6. company price can be saved and reloaded", async () => {
  const { db, catalog } = fakeDb([buildSnowProtectionCatalogItem("company-a")]);
  await catalog.updateOne({ companyId: "company-a" }, { $set: { priceNet: 25 } });
  const reloaded = await catalog.findOne({ companyId: "company-a" });
  assert.equal(reloaded?.priceNet, 25);
  await ensureCompanySnowProtectionCatalogItem(db, "company-a");
  assert.equal(reloaded?.priceNet, 25);
});

test("7. prices are independent between companies", async () => {
  const { catalog } = fakeDb([
    { ...buildSnowProtectionCatalogItem("company-a"), priceNet: 25 },
    { ...buildSnowProtectionCatalogItem("company-b"), priceNet: 55 },
  ]);
  assert.equal((await catalog.findOne({ companyId: "company-a" }))?.priceNet, 25);
  assert.equal((await catalog.findOne({ companyId: "company-b" }))?.priceNet, 55);
});

test("8. description update cannot remove plannerRole", () => {
  const existing = buildSnowProtectionCatalogItem("company-a");
  const metadata = preserveSnowProtectionPlannerRole(existing.metadata, { campaign: "winter" });
  assert.deepEqual(metadata, {
    campaign: "winter",
    plannerRole: SNOW_PROTECTION_PLANNER_ROLE,
  });
  assert.deepEqual(
    preserveSnowProtectionTechnicalFields(existing, {
      description: "New description",
      category: "extra",
      unit: "piece",
      isActive: false,
    }),
    {
      description: "New description",
      category: SNOW_PROTECTION_CATEGORY,
      unit: "m",
      unitLabel: "m",
      isActive: true,
    },
  );
});

test("9. normal deletion is blocked for the standard product", () => {
  assert.equal(canDeleteCatalogItem(buildSnowProtectionCatalogItem("company-a")), false);
});

test("10. another tenant cannot address the product", async () => {
  const { catalog } = fakeDb([buildSnowProtectionCatalogItem("company-a")]);
  const crossTenantResult = await catalog.findOne({ companyId: "company-b" });
  assert.equal(crossTenantResult, null);
});

test("11. ordinary product create, update and delete remain unchanged", async () => {
  const ordinary = { _id: new ObjectId(), companyId: "company-a", name: "Panel", metadata: {} };
  const { catalog } = fakeDb([ordinary]);
  assert.equal(canDeleteCatalogItem(ordinary), true);
  assert.equal(isSnowProtectionRoleAssignmentBlocked(ordinary, {}), false);
  await catalog.updateOne({ _id: ordinary._id, companyId: "company-a" }, { $set: { priceNet: 99 } });
  assert.equal((await catalog.findOne({ _id: ordinary._id }))?.priceNet, 99);
  assert.equal((await catalog.deleteOne({ _id: ordinary._id, companyId: "company-a" })).deletedCount, 1);
});

test("duplicate audit reports conflicts and refuses the unique index", async () => {
  const { db, catalog } = fakeDb([
    buildSnowProtectionCatalogItem("company-a"),
    buildSnowProtectionCatalogItem("company-a"),
  ]);
  const duplicates = await auditSnowProtectionDuplicates(db);
  assert.equal(duplicates.length, 1);
  await assert.rejects(ensureSnowProtectionUniqueIndex(db), /duplicate snow protection products/);
  assert.equal(catalog.indexesCreated.length, 0);
});

test("ordinary product cannot claim the reserved planner role", () => {
  assert.equal(
    isSnowProtectionRoleAssignmentBlocked(
      { companyId: "company-a", metadata: {} },
      { plannerRole: SNOW_PROTECTION_PLANNER_ROLE },
    ),
    true,
  );
});
