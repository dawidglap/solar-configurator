import "dotenv/config";
import bcrypt from "bcryptjs";
import { ObjectId, type Db, type Filter } from "mongodb";
import { getDb, getMongoClient } from "@/lib/db";
import { ensureTeamIndexes, hydrateTeams } from "@/lib/teams";
import { hasCloudinaryEnv } from "@/lib/cloudinary";
import { removePlanningFileCloudinaryAsset } from "@/lib/planningFiles";

const COMPANY_NAME = "Demo Company";
const DEFAULT_PASSWORD = process.env.DEMO_EMPLOYEE_PASSWORD || "Demo12345";
const DRY_RUN = process.argv.includes("--dry");

const COLORS = [
  "hsl(210 80% 58%)",
  "hsl(160 60% 45%)",
  "hsl(25 85% 58%)",
  "hsl(280 60% 62%)",
  "hsl(340 70% 58%)",
] as const;

const MONTAGE_EMPLOYEES = [
  ["Marco", "Keller"],
  ["Luca", "Meier"],
  ["Jonas", "Schmid"],
  ["Simon", "Weber"],
  ["Noah", "Frei"],
  ["Elias", "Graf"],
  ["Nico", "Baumann"],
  ["Fabian", "Suter"],
  ["Manuel", "Roth"],
  ["Adrian", "Berger"],
  ["Daniel", "Moser"],
  ["Patrick", "Huber"],
  ["Florian", "Brunner"],
  ["Tobias", "Steiner"],
  ["Samuel", "Widmer"],
] as const;

const ELEKTRO_EMPLOYEES = [
  ["David", "Kunz"],
  ["Michael", "Ackermann"],
  ["Raphael", "Hofer"],
  ["Dominik", "Scherrer"],
  ["Andreas", "Fuchs"],
  ["Kevin", "Gerber"],
  ["Oliver", "Marti"],
  ["Christian", "Wenger"],
  ["Stefan", "Ammann"],
  ["Thomas", "Egger"],
  ["Benjamin", "Ott"],
  ["Pascal", "Gasser"],
  ["Martin", "Ziegler"],
  ["Jan", "Bachmann"],
  ["Roman", "Stalder"],
] as const;

type EmployeeSeed = {
  firstName: string;
  lastName: string;
  email: string;
  executionRoles: ["montage"] | ["elektro"];
};

type DeletePlan = {
  collection: string;
  filter: Filter<any>;
  count: number;
};

function employeeSeeds(
  rows: ReadonlyArray<readonly [string, string]>,
  executionRole: "montage" | "elektro",
): EmployeeSeed[] {
  return rows.map(([firstName, lastName]) => ({
    firstName,
    lastName,
    email: `${firstName}.${lastName}@demo-company.ch`.toLowerCase(),
    executionRoles: [executionRole],
  }));
}

function variants(values: unknown[]) {
  const result: Array<string | ObjectId> = [];
  const seen = new Set<string>();
  const add = (value: string | ObjectId) => {
    const key = value instanceof ObjectId ? `oid:${value.toHexString()}` : `str:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  };

  for (const value of values) {
    if (value instanceof ObjectId) {
      add(value);
      add(value.toHexString());
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    add(text);
    if (ObjectId.isValid(text)) add(new ObjectId(text));
  }
  return result;
}

function companyFilter(companyValues: Array<string | ObjectId>): Filter<any> {
  return {
    $or: [
      { companyId: { $in: companyValues } },
      { company_id: { $in: companyValues } },
      { tenantId: { $in: companyValues } },
    ],
  };
}

function scopedReferences(
  companyValues: Array<string | ObjectId>,
  references: Filter<any>[],
): Filter<any> {
  return {
    $and: [companyFilter(companyValues), { $or: references.length ? references : [{ _id: null }] }],
  };
}

function collectReferenceValues(docs: any[], fields: string[]) {
  const values: unknown[] = [];
  for (const doc of docs) {
    values.push(doc?._id);
    for (const field of fields) {
      const parts = field.split(".");
      let current: any = doc;
      for (const part of parts) current = current?.[part];
      if (current != null && current !== "") values.push(current);
    }
  }
  return variants(values);
}

async function readExistingDocs(
  db: Db,
  existingCollections: Set<string>,
  names: string[],
  filter: Filter<any>,
) {
  const docs: any[] = [];
  for (const name of names) {
    if (!existingCollections.has(name)) continue;
    docs.push(...(await db.collection(name).find(filter).toArray()));
  }
  return docs;
}

async function addDeletePlan(
  plans: DeletePlan[],
  db: Db,
  existingCollections: Set<string>,
  collection: string,
  filter: Filter<any>,
) {
  if (!existingCollections.has(collection)) return;
  plans.push({
    collection,
    filter,
    count: await db.collection(collection).countDocuments(filter),
  });
}

async function buildCleanupPlan(db: Db, companyId: ObjectId) {
  const existingCollections = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name),
  );
  const companyValues = variants([companyId]);
  const directCompany = companyFilter(companyValues);

  const planningCollections = ["plannings", "planungen"];
  const planningDocs = await readExistingDocs(
    db,
    existingCollections,
    planningCollections,
    directCompany,
  );
  const planningValues = collectReferenceValues(planningDocs, ["planningId"]);
  const projectValues = collectReferenceValues(planningDocs, ["projectId", "data.projectId"]);
  const orderValues = variants(planningDocs.map((doc) => doc?.orderId));

  const auftragDocs = await readExistingDocs(
    db,
    existingCollections,
    ["auftraege", "orders"],
    directCompany,
  );
  const auftragValues = collectReferenceValues(auftragDocs, ["auftragId"]);
  const allOrderValues = variants([
    ...orderValues,
    ...auftragDocs.map((doc) => doc?.orderId),
  ]);

  const executionDocs = await readExistingDocs(
    db,
    existingCollections,
    ["executionTasks", "execution_tasks", "montages"],
    directCompany,
  );
  const executionTaskValues = collectReferenceValues(executionDocs, ["taskId", "montageId"]);

  const invoiceDocs = await readExistingDocs(
    db,
    existingCollections,
    ["invoices", "rechnungen"],
    directCompany,
  );
  const invoiceValues = collectReferenceValues(invoiceDocs, ["invoiceId"]);

  const projectReferences: Filter<any>[] = [
    { planningId: { $in: planningValues } },
    { linkedPlanningId: { $in: planningValues } },
    { sourcePlanningId: { $in: planningValues } },
    { projectId: { $in: projectValues } },
    { linkedProjectId: { $in: projectValues } },
    { orderId: { $in: allOrderValues } },
    { auftragId: { $in: auftragValues } },
  ];

  const taskDocs = await readExistingDocs(
    db,
    existingCollections,
    ["tasks", "aufgaben"],
    scopedReferences(companyValues, projectReferences),
  );
  const taskValues = collectReferenceValues(taskDocs, ["taskId"]);

  const plans: DeletePlan[] = [];
  const directCollections = [
    "plannings",
    "planungen",
    "offers",
    "angebote",
    "orders",
    "auftraege",
    "auftrag_steps_state",
    "auftrag_audit_logs",
    "executionTasks",
    "execution_tasks",
    "montages",
    "schedule_history",
    "executionActivities",
    "execution_activities",
    "invoices",
    "rechnungen",
    "invoice_payments",
    "invoice_events",
    "reminders",
    "mahnungen",
    "signatures",
    "signature_tokens",
  ];
  for (const collection of directCollections) {
    await addDeletePlan(plans, db, existingCollections, collection, directCompany);
  }

  const childReferences: Filter<any>[] = [
    ...projectReferences,
    { taskId: { $in: executionTaskValues } },
    { executionTaskId: { $in: executionTaskValues } },
    { montageId: { $in: executionTaskValues } },
    { invoiceId: { $in: invoiceValues } },
    { parentInvoiceId: { $in: invoiceValues } },
  ];
  for (const collection of [
    "schedule_history",
    "executionActivities",
    "execution_activities",
    "invoice_payments",
    "invoice_events",
    "reminders",
    "mahnungen",
    "signatures",
    "signature_tokens",
    "auftrag_steps_state",
    "auftrag_audit_logs",
  ]) {
    const existing = plans.find((plan) => plan.collection === collection);
    if (!existing) continue;
    existing.filter = {
      $or: [directCompany, scopedReferences(companyValues, childReferences)],
    };
    existing.count = await db.collection(collection).countDocuments(existing.filter);
  }

  const fileReferences: Filter<any>[] = [
    { planningId: { $in: planningValues } },
    { linkedPlanningId: { $in: planningValues } },
    { linkToPlanningId: { $in: planningValues } },
    { projectId: { $in: projectValues } },
    { linkedProjectId: { $in: projectValues } },
    { orderId: { $in: allOrderValues } },
  ];
  for (const collection of [
    "planningFiles",
    "planning_files",
    "projectFiles",
    "project_files",
    "uploads",
  ]) {
    await addDeletePlan(
      plans,
      db,
      existingCollections,
      collection,
      scopedReferences(companyValues, fileReferences),
    );
  }

  for (const collection of ["tasks", "aufgaben"]) {
    await addDeletePlan(
      plans,
      db,
      existingCollections,
      collection,
      scopedReferences(companyValues, projectReferences),
    );
  }
  const calendarReferences = [
    ...projectReferences,
    { linkedTaskId: { $in: taskValues } },
    { taskId: { $in: taskValues } },
  ];
  for (const collection of ["calendar_events", "calendarEvents"]) {
    await addDeletePlan(
      plans,
      db,
      existingCollections,
      collection,
      scopedReferences(companyValues, calendarReferences),
    );
  }

  return { plans, companyValues };
}

async function deleteProjectAssets(db: Db, planningFilesPlan: DeletePlan | undefined) {
  if (!planningFilesPlan || planningFilesPlan.count === 0 || !hasCloudinaryEnv()) {
    return { attempted: 0, deleted: 0, failed: 0 };
  }
  const docs = await db.collection("planningFiles").find(planningFilesPlan.filter).toArray();
  let deleted = 0;
  let failed = 0;
  for (const doc of docs) {
    try {
      await removePlanningFileCloudinaryAsset(doc);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("Cloudinary-Datei konnte nicht gelöscht werden:", String(doc?._id), error);
    }
  }
  return { attempted: docs.length, deleted, failed };
}

async function seedEmployeesAndTeams(
  db: Db,
  companyId: ObjectId,
  dryRun: boolean,
) {
  const employees = [
    ...employeeSeeds(MONTAGE_EMPLOYEES, "montage"),
    ...employeeSeeds(ELEKTRO_EMPLOYEES, "elektro"),
  ];
  const users = db.collection("users");
  const emails = employees.map((employee) => employee.email);
  const existingUsers = await users.find({ email: { $in: emails } }).toArray();
  const usersByEmail = new Map(existingUsers.map((user) => [String(user.email).toLowerCase(), user]));
  const passwordHash = dryRun ? "" : await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const now = new Date();
  let usersCreated = 0;
  let usersSkipped = 0;

  for (const employee of employees) {
    const existingUser = usersByEmail.get(employee.email);
    if (existingUser) {
      const hasCompanyMembership = Array.isArray(existingUser?.memberships)
        ? existingUser.memberships.some(
            (membership: any) =>
              String(membership?.companyId) === companyId.toHexString() &&
              membership?.status !== "inactive",
          )
        : false;
      const hasExecutionRole = Array.isArray(existingUser?.executionRoles)
        ? existingUser.executionRoles.includes(employee.executionRoles[0])
        : false;
      if (!hasCompanyMembership || !hasExecutionRole) {
        throw new Error(
          `Existierender Benutzer ${employee.email} gehört nicht mit der erwarteten Ausführungsrolle zur Demo Company.`,
        );
      }
      usersSkipped += 1;
      continue;
    }
    const userDoc = {
      email: employee.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      passwordHash,
      mustChangePassword: false,
      isPlatformSuperAdmin: false,
      status: "active",
      executionRoles: employee.executionRoles,
      memberships: [
        {
          companyId,
          role: "mitarbeiter",
          isDefault: true,
          status: "active",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    if (dryRun) {
      usersByEmail.set(employee.email, { ...userDoc, _id: new ObjectId() });
    } else {
      const inserted = await users.insertOne(userDoc);
      usersByEmail.set(employee.email, { ...userDoc, _id: inserted.insertedId });
    }
    usersCreated += 1;
  }

  const teamSeeds = [
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `Montage Team ${index + 1}`,
      track: "montage" as const,
      color: COLORS[index],
      employees: employees.slice(index * 3, index * 3 + 3),
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `Elektro Team ${index + 1}`,
      track: "elektro" as const,
      color: COLORS[index],
      employees: employees.slice(15 + index * 3, 15 + index * 3 + 3),
    })),
  ];
  const companyValues = variants([companyId]);
  const teams = db.collection("teams");
  const existingNamedTeams = await teams
    .find({
      companyId: { $in: companyValues },
      name: { $in: teamSeeds.map((team) => team.name) },
    })
    .toArray();
  for (const team of teamSeeds) {
    if (existingNamedTeams.filter((item) => item?.name === team.name).length > 1) {
      throw new Error(`Mehrere Teams mit dem Namen "${team.name}" gefunden.`);
    }
  }

  const expectedTeamByUserId = new Map<string, string>();
  for (const team of teamSeeds) {
    for (const employee of team.employees) {
      const user = usersByEmail.get(employee.email);
      if (!user?._id) throw new Error(`Mitarbeiter ${employee.email} konnte nicht aufgelöst werden.`);
      expectedTeamByUserId.set(String(user._id), team.name);
    }
  }
  const targetUserIds = [...expectedTeamByUserId.keys()].map((id) => new ObjectId(id));
  const activeMemberships = await teams
    .find({
      companyId: { $in: companyValues },
      status: "active",
      "members.userId": { $in: targetUserIds },
    })
    .toArray();
  const conflicts: Array<{ userId: string; existingTeam: string; expectedTeam: string }> = [];
  for (const team of activeMemberships) {
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      const userId = String(member?.userId || "");
      const expectedTeam = expectedTeamByUserId.get(userId);
      if (expectedTeam && expectedTeam !== team?.name) {
        conflicts.push({ userId, existingTeam: String(team?.name || ""), expectedTeam });
      }
    }
  }
  if (conflicts.length) {
    throw new Error(`Teamkonflikte für Seed-Mitarbeiter: ${JSON.stringify(conflicts)}`);
  }

  let teamsCreated = 0;
  let teamsUpdated = 0;
  for (const team of teamSeeds) {
    const members = team.employees.map((employee, index) => ({
      userId: usersByEmail.get(employee.email)!._id,
      role: index === 0 ? "leiter" : team.track === "montage" ? "monteur" : "elektriker",
    }));
    const existing = existingNamedTeams.find((item) => item?.name === team.name);
    if (existing) teamsUpdated += 1;
    else teamsCreated += 1;
    if (!dryRun) {
      await teams.updateOne(
        existing ? { _id: existing._id } : { companyId, name: team.name },
        {
          $set: {
            companyId,
            name: team.name,
            color: team.color,
            tracks: [team.track],
            members,
            status: "active",
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
    }
  }

  return { usersCreated, usersSkipped, teamsCreated, teamsUpdated };
}

async function verifyCurrentSeedState(db: Db, companyId: ObjectId, requireComplete: boolean) {
  const employees = [
    ...employeeSeeds(MONTAGE_EMPLOYEES, "montage"),
    ...employeeSeeds(ELEKTRO_EMPLOYEES, "elektro"),
  ];
  const users = await db
    .collection("users")
    .find({ email: { $in: employees.map((employee) => employee.email) } })
    .toArray();
  const expectedTeamNames = [
    ...Array.from({ length: 5 }, (_, index) => `Montage Team ${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `Elektro Team ${index + 1}`),
  ];
  const teams = await db
    .collection("teams")
    .find({
      companyId: { $in: variants([companyId]) },
      name: { $in: expectedTeamNames },
      status: "active",
    })
    .toArray();
  const memberIds = teams.flatMap((team) =>
    Array.isArray(team?.members) ? team.members.map((member: any) => String(member?.userId)) : [],
  );
  const uniqueMemberIds = new Set(memberIds);
  const hydratedTeams = await hydrateTeams(db, teams);
  const resolvedMembers = hydratedTeams
    .flatMap((team) => team.members)
    .filter(
      (member) =>
        !!member.userId && !!member.fullName && !!member.email && !!member.role,
    ).length;

  if (requireComplete) {
    if (users.length !== 30) throw new Error(`Seed-Prüfung: ${users.length} statt 30 Mitarbeiter gefunden.`);
    if (teams.length !== 10) throw new Error(`Seed-Prüfung: ${teams.length} statt 10 aktive Teams gefunden.`);
    if (memberIds.length !== 30 || uniqueMemberIds.size !== 30) {
      throw new Error("Seed-Prüfung: Teammitglieder sind nicht exakt und eindeutig auf 10 Teams verteilt.");
    }
    if (teams.some((team) => !Array.isArray(team?.members) || team.members.length !== 3)) {
      throw new Error("Seed-Prüfung: Mindestens ein Team hat nicht genau drei Mitglieder.");
    }
    if (resolvedMembers !== 30) {
      throw new Error("Seed-Prüfung: Nicht alle Teammitglieder können mit Name und E-Mail aufgelöst werden.");
    }
  }

  return {
    currentEmployees: users.length,
    currentActiveTeams: teams.length,
    currentTeamMemberships: memberIds.length,
    uniqueActiveTeamMembers: uniqueMemberIds.size,
    membersResolvableWithNameAndEmail: resolvedMembers,
  };
}

async function main() {
  const db = await getDb();
  const companies = await db.collection("companies").find({ name: COMPANY_NAME }).toArray();
  if (companies.length === 0) throw new Error(`Mandant "${COMPANY_NAME}" nicht gefunden.`);
  if (companies.length > 1) {
    throw new Error(`Mehrere Mandanten mit dem Namen "${COMPANY_NAME}" gefunden; Abbruch.`);
  }
  const companyId = companies[0]._id;
  if (!(companyId instanceof ObjectId)) throw new Error("Demo-Company hat keine gültige ObjectId.");

  const { plans } = await buildCleanupPlan(db, companyId);
  if (!DRY_RUN) {
    await seedEmployeesAndTeams(db, companyId, true);
    await ensureTeamIndexes(db);
  }
  const deletedByCollection: Record<string, number> = {};
  let cloudinaryAssets = { attempted: 0, deleted: 0, failed: 0 };
  if (DRY_RUN) {
    for (const plan of plans) deletedByCollection[plan.collection] = plan.count;
  } else {
    cloudinaryAssets = await deleteProjectAssets(
      db,
      plans.find((plan) => plan.collection === "planningFiles"),
    );
    for (const plan of plans) {
      const result = await db.collection(plan.collection).deleteMany(plan.filter);
      deletedByCollection[plan.collection] = result.deletedCount;
    }
  }

  const seeded = await seedEmployeesAndTeams(db, companyId, DRY_RUN);
  const verification = await verifyCurrentSeedState(db, companyId, !DRY_RUN);
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: DRY_RUN,
        database: db.databaseName,
        company: { id: companyId.toHexString(), name: COMPANY_NAME },
        deletedByCollection,
        cloudinaryAssets: DRY_RUN
          ? { planned: plans.find((plan) => plan.collection === "planningFiles")?.count ?? 0 }
          : cloudinaryAssets,
        employees: {
          requested: 30,
          created: seeded.usersCreated,
          skippedExistingEmail: seeded.usersSkipped,
        },
        teams: {
          requested: 10,
          created: seeded.teamsCreated,
          updated: seeded.teamsUpdated,
        },
        verification,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Demo-Company Cleanup/Seed fehlgeschlagen:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close().catch(() => undefined);
  });
