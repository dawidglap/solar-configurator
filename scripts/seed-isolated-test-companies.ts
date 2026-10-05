import "dotenv/config";

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { BSON, ObjectId, type Db, type Document } from "mongodb";

import { POST as login } from "@/app/api/auth/login/route";
import { GET as getCatalogItems } from "@/app/api/catalog-items/route";
import { GET as getCompanyProfile } from "@/app/api/company-profile/route";
import { GET as getCustomers } from "@/app/api/customers/route";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getPlannings } from "@/app/api/plannings/route";
import { GET as getTasks } from "@/app/api/tasks/route";
import { GET as getTeams } from "@/app/api/teams/route";
import { GET as getUsers } from "@/app/api/users/route";
import { ensureCompanyAuftragPipelineTemplate } from "@/lib/auftragPipeline";
import { getDb, getMongoClient } from "@/lib/db";
import {
  ensureCompanySnowProtectionCatalogItem,
  ensureSnowProtectionUniqueIndex,
  SNOW_PROTECTION_INDEX_NAME,
  SNOW_PROTECTION_PLANNER_ROLE,
} from "@/lib/snowProtectionCatalog";
import {
  buildNewCompanySubscriptionDefaults,
  buildUniqueCompanySlug,
} from "@/lib/subscription";
import { ensureTeamIndexes } from "@/lib/teams";

const EXPECTED_DATABASE = "sola";
const DEMO_COMPANY_NAME = "Demo Company";
const PASSWORD = "Demo12345";
const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify") || APPLY;
const SEED_VERSION = "isolated-test-v1";

const TARGETS = [
  {
    key: "ivan",
    firstName: "Ivan",
    companyName: "Test Ivan",
    ownerEmail: "ivan@test-ivan.ch",
    domain: "test-ivan.ch",
  },
  {
    key: "roberto",
    firstName: "Roberto",
    companyName: "Test Roberto",
    ownerEmail: "roberto@test-roberto.ch",
    domain: "test-roberto.ch",
  },
  {
    key: "marco",
    firstName: "Marco",
    companyName: "Test Marco",
    ownerEmail: "marco@test-marco.ch",
    domain: "test-marco.ch",
  },
] as const;

const EMPLOYEES = [
  ["Anna", "Keller", "montage"],
  ["Luca", "Meier", "montage"],
  ["Noah", "Frei", "montage"],
  ["Mia", "Kunz", "elektro"],
  ["David", "Graf", "elektro"],
  ["Lea", "Moser", "elektro"],
] as const;

const CUSTOMER_SEEDS = [
  ["Muster", "Anna", "Zürich", "8000"],
  ["Beispiel", "Bruno", "Bern", "3000"],
  ["Test", "Carla", "Basel", "4001"],
  ["Solar", "Daniel", "Luzern", "6003"],
  ["Demo", "Eva", "St. Gallen", "9000"],
] as const;

const DEMO_FINGERPRINT_COLLECTIONS = [
  "catalogItems",
  "customers",
  "executionTasks",
  "invoices",
  "plannings",
  "tasks",
  "teams",
] as const;

type Target = (typeof TARGETS)[number];

type SeedContext = {
  target: Target;
  seedKey: string;
  companyId: ObjectId;
  ownerId: ObjectId;
};

type Counts = {
  company: number;
  owner: number;
  employees: number;
  teams: number;
  customers: number;
  catalogItems: number;
  pipelineTemplates: number;
  plannings: number;
  executionTasks: number;
  tasks: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function seedKey(target: Target) {
  return `${SEED_VERSION}:${target.key}`;
}

function clone<T>(value: T): T {
  return BSON.EJSON.parse(BSON.EJSON.stringify(value, { relaxed: false }));
}

function companyVariants(companyId: ObjectId | string) {
  const value = String(companyId);
  return ObjectId.isValid(value) ? [value, new ObjectId(value)] : [value];
}

function stableCatalogKey(doc: Document) {
  const stable = [
    doc.category,
    doc.subcategory,
    doc.brand,
    doc.model,
    doc.name,
    doc.unit,
    doc.sortOrder,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 20);
}

async function countTargetDocuments(db: Db, context: SeedContext): Promise<Counts> {
  const companyId = context.companyId.toHexString();
  const variants = companyVariants(context.companyId);
  const [company, owner, employees, teams, customers, catalogItems, pipelineTemplates, plannings, executionTasks, tasks] =
    await Promise.all([
      db.collection("companies").countDocuments({ _id: context.companyId, testSeedKey: context.seedKey }),
      db.collection("users").countDocuments({ _id: context.ownerId, testSeedKey: `${context.seedKey}:owner` }),
      db.collection("users").countDocuments({ testSeedKey: { $regex: `^${context.seedKey}:employee:` } }),
      db.collection("teams").countDocuments({ companyId: { $in: variants }, testSeedKey: { $regex: `^${context.seedKey}:team:` } }),
      db.collection("customers").countDocuments({ companyId, testSeedKey: { $regex: `^${context.seedKey}:customer:` } }),
      db.collection("catalogItems").countDocuments({ companyId }),
      db.collection("auftrag_pipeline_templates").countDocuments({ companyId: context.companyId }),
      db.collection("plannings").countDocuments({ companyId, testSeedKey: { $regex: `^${context.seedKey}:planning:` } }),
      db.collection("executionTasks").countDocuments({ companyId, track: { $in: ["montage", "elektro"] } }),
      db.collection("tasks").countDocuments({ companyId, testSeedKey: { $regex: `^${context.seedKey}:task:` } }),
    ]);

  return { company, owner, employees, teams, customers, catalogItems, pipelineTemplates, plannings, executionTasks, tasks };
}

function plannedCounts(existing: Counts, catalogTemplateCount: number): Counts {
  const desired: Counts = {
    company: 1,
    owner: 1,
    employees: EMPLOYEES.length,
    teams: 2,
    customers: CUSTOMER_SEEDS.length,
    catalogItems: catalogTemplateCount + 1,
    pipelineTemplates: 1,
    plannings: 0,
    executionTasks: 0,
    tasks: 0,
  };
  return Object.fromEntries(
    Object.entries(desired).map(([key, value]) => [key, Math.max(0, value - existing[key as keyof Counts])]),
  ) as Counts;
}

async function resolveContext(db: Db, target: Target): Promise<SeedContext> {
  const key = seedKey(target);
  const companiesByName = await db.collection("companies").find({ name: target.companyName }).toArray();
  const companiesByKey = await db.collection("companies").find({ testSeedKey: key }).toArray();
  const user = await db.collection("users").findOne({ email: target.ownerEmail });

  assert(companiesByName.length <= 1, `Più company trovate con nome ${target.companyName}`);
  assert(companiesByKey.length <= 1, `Più company trovate con seed key ${key}`);
  if (companiesByName[0]) {
    assert(companiesByName[0].testSeedKey === key, `${target.companyName} esiste ma non appartiene a questo seed`);
  }
  if (companiesByKey[0]) {
    assert(companiesByKey[0].name === target.companyName, `${key} è associata a una company inattesa`);
  }

  const company = companiesByKey[0] ?? companiesByName[0] ?? null;
  if (user) {
    assert(user.testSeedKey === `${key}:owner`, `${target.ownerEmail} esiste ma non appartiene a questo seed`);
    if (company) {
      const expectedCompanyId = company._id.toString();
      const memberships = Array.isArray(user.memberships) ? user.memberships : [];
      assert(
        memberships.some(
          (membership: any) =>
            String(membership?.companyId) === expectedCompanyId &&
            membership?.status === "active" &&
            membership?.role === "owner",
        ),
        `${target.ownerEmail} non ha la membership owner attesa`,
      );
    }
  }

  return {
    target,
    seedKey: key,
    companyId: company?._id instanceof ObjectId ? company._id : new ObjectId(),
    ownerId: user?._id instanceof ObjectId ? user._id : new ObjectId(),
  };
}

async function fingerprintDemoCompany(db: Db, demoCompany: Document) {
  const companyId = demoCompany._id.toString();
  const variants = companyVariants(companyId);
  const snapshot: Record<string, unknown> = { company: demoCompany };

  snapshot.users = await db
    .collection("users")
    .find({ "memberships.companyId": { $in: variants } })
    .sort({ _id: 1 })
    .toArray();
  for (const collectionName of DEMO_FINGERPRINT_COLLECTIONS) {
    snapshot[collectionName] = await db
      .collection(collectionName)
      .find({ companyId: { $in: variants } })
      .sort({ _id: 1 })
      .toArray();
  }

  return crypto
    .createHash("sha256")
    .update(BSON.EJSON.stringify(snapshot, { relaxed: false }))
    .digest("hex");
}

function companyTemplate(demoCompany: Document) {
  const fields = [
    "defaults",
    "paymentDefaults",
    "pdfSettings",
    "pipelineStages",
    "plannerDefaults",
    "templates",
  ] as const;
  return Object.fromEntries(
    fields.filter((field) => demoCompany[field] !== undefined).map((field) => [field, clone(demoCompany[field])]),
  );
}

async function createCompanyAndOwner(
  db: Db,
  context: SeedContext,
  demoCompany: Document,
  passwordHash: string,
) {
  const now = new Date();
  const company = await db.collection("companies").findOne({ _id: context.companyId });
  if (!company) {
    const subscription = buildNewCompanySubscriptionDefaults(now);
    await db.collection("companies").insertOne({
      _id: context.companyId,
      name: context.target.companyName,
      slug: await buildUniqueCompanySlug(db, context.target.companyName),
      ...companyTemplate(demoCompany),
      ...subscription,
      maxUsers: 10,
      contact: { email: context.target.ownerEmail },
      address: { street: "Teststrasse 1", zip: "8000", city: "Zürich", country: "Schweiz" },
      testSeedKey: context.seedKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  const owner = await db.collection("users").findOne({ _id: context.ownerId });
  if (!owner) {
    await db.collection("users").insertOne({
      _id: context.ownerId,
      email: context.target.ownerEmail,
      firstName: context.target.firstName,
      lastName: "Test",
      passwordHash,
      mustChangePassword: false,
      isPlatformSuperAdmin: false,
      sessionVersion: 0,
      status: "active",
      memberships: [
        {
          companyId: context.companyId,
          role: "owner",
          status: "active",
          isDefault: true,
        },
      ],
      testSeedKey: `${context.seedKey}:owner`,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function seedEmployeesAndTeams(db: Db, context: SeedContext, passwordHash: string) {
  const users = db.collection("users");
  const now = new Date();
  const employees: Document[] = [];

  for (const [firstName, lastName, track] of EMPLOYEES) {
    const key = `${context.seedKey}:employee:${track}:${firstName.toLowerCase()}`;
    const email = `${firstName}.${lastName}.${context.target.key}@${context.target.domain}`.toLowerCase();
    const byEmail = await users.findOne({ email });
    const byKey = await users.findOne({ testSeedKey: key });
    assert(!byEmail || byEmail.testSeedKey === key, `Conflitto email dipendente ${email}`);
    assert(!byKey || byKey.email === email, `Conflitto seed dipendente ${key}`);
    if (!byEmail && !byKey) {
      await users.insertOne({
        email,
        firstName,
        lastName,
        passwordHash,
        mustChangePassword: false,
        isPlatformSuperAdmin: false,
        status: "active",
        executionRoles: [track],
        memberships: [
          { companyId: context.companyId, role: "mitarbeiter", status: "active", isDefault: true },
        ],
        testSeedKey: key,
        createdAt: now,
        updatedAt: now,
      });
    }
    employees.push((await users.findOne({ testSeedKey: key }))!);
  }

  await ensureTeamIndexes(db);
  for (const track of ["montage", "elektro"] as const) {
    const key = `${context.seedKey}:team:${track}`;
    const members = employees
      .filter((employee) => employee.executionRoles?.includes(track))
      .map((employee, index) => ({
        userId: employee._id,
        role: index === 0 ? "leiter" : track === "montage" ? "monteur" : "elektriker",
      }));
    await db.collection("teams").updateOne(
      { companyId: context.companyId, testSeedKey: key },
      {
        $setOnInsert: {
          companyId: context.companyId,
          name: track === "montage" ? "Montage Team 1" : "Elektro Team 1",
          color: track === "montage" ? "hsl(210 80% 58%)" : "hsl(160 60% 45%)",
          tracks: [track],
          members,
          status: "active",
          testSeedKey: key,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
}

async function seedCustomers(db: Db, context: SeedContext) {
  const now = new Date();
  for (let index = 0; index < CUSTOMER_SEEDS.length; index += 1) {
    const [lastName, firstName, city, zip] = CUSTOMER_SEEDS[index];
    const key = `${context.seedKey}:customer:${index + 1}`;
    await db.collection("customers").updateOne(
      { companyId: context.companyId.toHexString(), testSeedKey: key },
      {
        $setOnInsert: {
          companyId: context.companyId.toHexString(),
          type: "private",
          salutation: index % 2 === 0 ? "Frau" : "Herr",
          firstName,
          lastName,
          name: `${firstName} ${lastName}`,
          email: `kunde${index + 1}.${context.target.key}@${context.target.domain}`,
          phone: "+41 00 000 00 00",
          street: "Musterstrasse",
          streetNo: String(index + 1),
          zip,
          city,
          country: "Schweiz",
          buildingStreet: "Musterstrasse",
          buildingStreetNo: String(index + 1),
          buildingZip: zip,
          buildingCity: city,
          status: "active",
          duplicateOfCustomerId: null,
          createdByUserId: context.ownerId.toHexString(),
          testSeedKey: key,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
}

async function seedCatalog(db: Db, context: SeedContext, templates: Document[]) {
  const now = new Date();
  const targetCompanyId = context.companyId.toHexString();
  const keyOccurrences = new Map<string, number>();
  for (const template of templates) {
    const baseKey = `${context.seedKey}:catalog:${stableCatalogKey(template)}`;
    const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
    keyOccurrences.set(baseKey, occurrence);
    const key = occurrence === 1 ? baseKey : `${baseKey}:${occurrence}`;
    const copy = clone(template);
    delete copy._id;
    delete copy.companyId;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.testSeedKey;
    await db.collection("catalogItems").updateOne(
      { companyId: targetCompanyId, testSeedKey: key },
      {
        $setOnInsert: {
          ...copy,
          companyId: targetCompanyId,
          testSeedKey: key,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
  await ensureCompanySnowProtectionCatalogItem(db, context.companyId);
}

async function parseJson(response: Response) {
  const value = await response.json().catch(() => null);
  return value as any;
}

async function verifyLoginAndApis(db: Db, context: SeedContext) {
  const loginResponse = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: context.target.ownerEmail, password: PASSWORD }),
    }),
  );
  assert(loginResponse.status === 200, `Login fallito per ${context.target.ownerEmail}`);
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, `Cookie sessione assente per ${context.target.ownerEmail}`);

  const request = (path: string) => new Request(`http://localhost${path}`, { headers: { cookie } });
  const checks = [
    ["me", getMe, "/api/me"],
    ["customers", getCustomers, "/api/customers"],
    ["settings", getCompanyProfile, "/api/company-profile"],
    ["catalog", getCatalogItems, "/api/catalog-items"],
    ["plannings", getPlannings, "/api/plannings"],
    ["tasks", getTasks, "/api/tasks"],
    ["users", getUsers, "/api/users"],
    ["teams", getTeams, "/api/teams"],
  ] as const;
  const payloads: Record<string, any> = {};
  for (const [name, handler, path] of checks) {
    const response = await handler(request(path));
    assert(response.status === 200, `${name} API ha risposto ${response.status} per ${context.target.companyName}`);
    payloads[name] = await parseJson(response);
    assert(payloads[name]?.ok === true, `${name} API non è ok per ${context.target.companyName}`);
  }

  assert(payloads.me?.session?.activeCompanyId === context.companyId.toHexString(), "activeCompanyId inattivo o errato");
  assert(payloads.me?.session?.activeRole === "owner", "Ruolo owner non attivo");
  assert(payloads.me?.activeCompany?.name === context.target.companyName, "Company attiva errata");

  const ownCustomerIds = new Set(
    (await db.collection("customers").find({ companyId: context.companyId.toHexString() }, { projection: { _id: 1 } }).toArray()).map(
      (doc) => doc._id.toString(),
    ),
  );
  const apiCustomerIds = (payloads.customers?.items ?? []).map((item: any) => String(item.id));
  assert(apiCustomerIds.every((id: string) => ownCustomerIds.has(id)), "API Kunden ha restituito dati cross-tenant");
  assert(apiCustomerIds.length === CUSTOMER_SEEDS.length, "Numero clienti API inatteso");

  const apiCatalog = payloads.catalog?.items ?? [];
  assert(apiCatalog.length === (await db.collection("catalogItems").countDocuments({ companyId: context.companyId.toHexString() })), "Catalogo API incompleto");
  assert((payloads.users?.items ?? []).length === EMPLOYEES.length + 1, "Employees API incompleta");
  assert((payloads.teams?.items ?? []).length === 2, "Teams API incompleta");
  assert((payloads.plannings?.items ?? []).length === 0, "Projekte API deve essere vuota");
  assert((payloads.tasks?.items ?? []).length === 0, "Aufgaben API deve essere vuota");

  return {
    login: true,
    activeCompany: context.target.companyName,
    activeRole: "owner",
    apis: checks.map(([name]) => name),
  };
}

async function verifyDatabaseState(db: Db, contexts: SeedContext[], catalogTemplateCount: number) {
  const allIdsByType: Record<string, Set<string>> = {
    customers: new Set(),
    employees: new Set(),
    teams: new Set(),
    catalogItems: new Set(),
    plannings: new Set(),
  };
  const results = [];

  for (const context of contexts) {
    const counts = await countTargetDocuments(db, context);
    assert(counts.company === 1 && counts.owner === 1, `Company/owner incompleti per ${context.target.companyName}`);
    assert(counts.employees === EMPLOYEES.length, `Employees incompleti per ${context.target.companyName}`);
    assert(counts.teams === 2, `Teams incompleti per ${context.target.companyName}`);
    assert(counts.customers === CUSTOMER_SEEDS.length, `Customers incompleti per ${context.target.companyName}`);
    assert(counts.catalogItems === catalogTemplateCount + 1, `Catalogo incompleto per ${context.target.companyName}`);
    assert(counts.pipelineTemplates === 1, `Pipeline incompleta per ${context.target.companyName}`);
    assert(counts.plannings === 0 && counts.executionTasks === 0 && counts.tasks === 0, `Dati operativi inattesi per ${context.target.companyName}`);

    const companyId = context.companyId.toHexString();
    const snowItems = await db.collection("catalogItems").find({ companyId, "metadata.plannerRole": SNOW_PROTECTION_PLANNER_ROLE }).toArray();
    assert(snowItems.length === 1, `Schneefang non univoco per ${context.target.companyName}`);
    assert(snowItems[0].unit === "m" && snowItems[0].priceNet === 0, `Schneefang non canonico per ${context.target.companyName}`);

    const scoped = {
      customers: await db.collection("customers").find({ companyId }).toArray(),
      employees: await db.collection("users").find({ testSeedKey: { $regex: `^${context.seedKey}:employee:` } }).toArray(),
      teams: await db.collection("teams").find({ companyId: { $in: companyVariants(context.companyId) } }).toArray(),
      catalogItems: await db.collection("catalogItems").find({ companyId }).toArray(),
      plannings: await db.collection("plannings").find({ companyId }).toArray(),
    };
    for (const [type, docs] of Object.entries(scoped)) {
      for (const doc of docs) {
        const id = doc._id.toString();
        assert(!allIdsByType[type].has(id), `${type} contiene un ID condiviso tra tenant`);
        allIdsByType[type].add(id);
      }
    }

    results.push({ company: context.target.companyName, counts, snowProtection: "ok" });
  }
  return results;
}

async function main() {
  const db = await getDb();
  assert(db.databaseName === EXPECTED_DATABASE, `Database non autorizzato: ${db.databaseName}`);

  const demos = await db.collection("companies").find({ name: DEMO_COMPANY_NAME }).toArray();
  assert(demos.length === 1, `Attesa una sola ${DEMO_COMPANY_NAME}, trovate ${demos.length}`);
  const demoCompany = demos[0];
  const demoFingerprintBefore = await fingerprintDemoCompany(db, demoCompany);
  const demoCompanyId = demoCompany._id.toString();
  const catalogTemplates = await db
    .collection("catalogItems")
    .find({
      companyId: { $in: companyVariants(demoCompanyId) },
      "metadata.plannerRole": { $ne: SNOW_PROTECTION_PLANNER_ROLE },
    })
    .sort({ category: 1, sortOrder: 1, name: 1, _id: 1 })
    .toArray();
  assert(catalogTemplates.length > 0, "La Demo Company non contiene template catalogo utilizzabili");

  const contexts: SeedContext[] = [];
  const dryRun = [];
  for (const target of TARGETS) {
    const context = await resolveContext(db, target);
    contexts.push(context);
    const existing = await countTargetDocuments(db, context);
    dryRun.push({
      company: target.companyName,
      ownerEmail: target.ownerEmail,
      emailExists: existing.owner === 1,
      companyExists: existing.company === 1,
      existing,
      wouldCreate: plannedCounts(existing, catalogTemplates.length),
    });
  }

  console.log(JSON.stringify({ ok: true, mode: APPLY ? "apply" : "dry-run", database: db.databaseName, dryRun }, null, 2));
  if (!APPLY) return;

  await ensureSnowProtectionUniqueIndex(db);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const context of contexts) {
    await createCompanyAndOwner(db, context, demoCompany, passwordHash);
    await seedEmployeesAndTeams(db, context, passwordHash);
    await seedCustomers(db, context);
    await seedCatalog(db, context, catalogTemplates);
    await ensureCompanyAuftragPipelineTemplate(db, context.companyId, {
      id: context.ownerId.toHexString(),
      fullName: `${context.target.firstName} Test`,
    });
  }

  const databaseVerification = await verifyDatabaseState(db, contexts, catalogTemplates.length);
  const loginAndApiVerification = VERIFY
    ? await Promise.all(contexts.map((context) => verifyLoginAndApis(db, context)))
    : [];
  const demoFingerprintAfter = await fingerprintDemoCompany(db, demoCompany);
  assert(demoFingerprintAfter === demoFingerprintBefore, "La Demo Company è cambiata durante il seed");

  const indexes = await db.collection("catalogItems").indexes();
  assert(indexes.some((index) => index.name === SNOW_PROTECTION_INDEX_NAME && index.unique === true), "Indice univoco Schneefang assente");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "completed",
        database: db.databaseName,
        databaseVerification,
        loginAndApiVerification,
        snowProtectionUniqueIndex: true,
        demoCompanyUnchanged: true,
      },
      null,
      2,
    ),
  );
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
