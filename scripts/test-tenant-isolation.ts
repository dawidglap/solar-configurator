import "dotenv/config";

import { POST as login } from "@/app/api/auth/login/route";
import { GET as getCatalogItem } from "@/app/api/catalog-items/[itemId]/route";
import { GET as getCatalogItems } from "@/app/api/catalog-items/route";
import { GET as getCustomer } from "@/app/api/customers/[customerId]/route";
import { GET as getCustomers } from "@/app/api/customers/route";
import { GET as getExecutionTask } from "@/app/api/execution-tasks/[taskId]/route";
import { GET as getExecutionTasks } from "@/app/api/execution-tasks/route";
import { GET as getInvoice } from "@/app/api/invoices/[invoiceId]/route";
import { GET as getInvoices } from "@/app/api/invoices/route";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getOrder } from "@/app/api/orders/[orderId]/route";
import { GET as getOrders } from "@/app/api/orders/route";
import { GET as getPlanning } from "@/app/api/plannings/[planningId]/route";
import { GET as getPlannings } from "@/app/api/plannings/route";
import { GET as getTasks } from "@/app/api/tasks/route";
import { GET as getTeams } from "@/app/api/teams/route";
import { GET as getTrash } from "@/app/api/trash/route";
import { GET as getUsers } from "@/app/api/users/route";
import { getDb, getMongoClient } from "@/lib/db";

const EXPECTED_DATABASE = "sola";
const PASSWORD = "Demo12345";
const ACCOUNTS = [
  { email: "ivan@test-ivan.ch", company: "Test Ivan" },
  { email: "roberto@test-roberto.ch", company: "Test Roberto" },
  { email: "marco@test-marco.ch", company: "Test Marco" },
] as const;

type Handler = (request: Request) => Promise<Response>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  return response.json().catch(() => null) as Promise<any>;
}

async function authenticate(email: string) {
  const response = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  assert(response.status === 200, `Login fallito per ${email}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, `Session cookie assente per ${email}`);
  return cookie;
}

function request(cookie: string, path: string) {
  return new Request(`http://localhost${path}`, { headers: { cookie } });
}

async function callList(cookie: string, path: string, handler: Handler) {
  const response = await handler(request(cookie, path));
  const body = await json(response);
  assert(response.status === 200 && body?.ok === true, `${path} ha risposto ${response.status}`);
  return body;
}

function itemIds(body: any) {
  return new Set<string>((Array.isArray(body?.items) ? body.items : []).map((item: any) => String(item?.id ?? item?._id ?? item?.planningId ?? "")).filter(Boolean));
}

async function expectHidden(label: string, response: Response) {
  assert([403, 404].includes(response.status), `${label}: atteso 403/404, ricevuto ${response.status}`);
}

async function main() {
  const db = await getDb();
  assert(db.databaseName === EXPECTED_DATABASE, `Database inatteso: ${db.databaseName}`);

  const demoCompany = await db.collection("companies").findOne({ name: "Demo Company" });
  assert(demoCompany, "Demo Company assente");
  const demoCompanyId = demoCompany._id.toString();
  const demoPlanning = await db.collection("plannings").findOne({ companyId: demoCompanyId });
  const demoCustomer = await db.collection("customers").findOne({ companyId: demoCompanyId });
  const demoInvoice = await db.collection("invoices").findOne({ companyId: demoCompanyId });
  const demoExecution = await db.collection("executionTasks").findOne({ companyId: demoCompanyId });
  const demoCatalogItem = await db.collection("catalogItems").findOne({ companyId: demoCompanyId });
  const demoTask = await db.collection("tasks").findOne({ companyId: demoCompanyId });
  const demoOrderPlanning = await db.collection("plannings").findOne({ companyId: demoCompanyId, orderId: { $type: "string", $ne: "" } });
  assert(demoPlanning && demoCustomer && demoCatalogItem, "Dati Demo minimi assenti");

  const reports = [];
  const ownObjects: Array<{ companyId: string; planningId: string; customerId: string; catalogItemId: string }> = [];

  for (const account of ACCOUNTS) {
    const cookie = await authenticate(account.email);
    const me = await callList(cookie, "/api/me", getMe);
    assert(me?.activeCompany?.name === account.company, `Company attiva errata per ${account.email}`);
    assert(me?.session?.activeRole === "owner", `Ruolo attivo errato per ${account.email}`);
    const companyId = String(me.session.activeCompanyId);

    const [plannings, customers, orders, invoices, tasks, execution, catalog, users, teams, trash] = await Promise.all([
      callList(cookie, "/api/plannings?limit=300", getPlannings),
      callList(cookie, "/api/customers", getCustomers),
      callList(cookie, "/api/orders", getOrders),
      callList(cookie, "/api/invoices", getInvoices),
      callList(cookie, "/api/tasks", getTasks),
      callList(cookie, "/api/execution-tasks", getExecutionTasks),
      callList(cookie, "/api/catalog-items", getCatalogItems),
      callList(cookie, "/api/users", getUsers),
      callList(cookie, "/api/teams", getTeams),
      callList(cookie, "/api/trash", getTrash),
    ]);

    const expected = {
      plannings: new Set((await db.collection("plannings").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
      customers: new Set((await db.collection("customers").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
      invoices: new Set((await db.collection("invoices").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
      tasks: new Set((await db.collection("tasks").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
      execution: new Set((await db.collection("executionTasks").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
      catalog: new Set((await db.collection("catalogItems").find({ companyId }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id.toString())),
    };

    for (const [label, body, ids] of [
      ["plannings", plannings, expected.plannings],
      ["customers", customers, expected.customers],
      ["invoices", invoices, expected.invoices],
      ["tasks", tasks, expected.tasks],
      ["execution", execution, expected.execution],
      ["catalog", catalog, expected.catalog],
    ] as const) {
      const returned = itemIds(body);
      assert([...returned].every((id) => ids.has(id)), `${label}: risposta cross-tenant per ${account.company}`);
    }

    const planningItems = plannings.items ?? [];
    const customerItems = customers.items ?? [];
    const catalogItems = catalog.items ?? [];
    assert(planningItems.length === 3, `Numero progetti inatteso per ${account.company}`);
    assert(customerItems.length === 5, `Numero clienti inatteso per ${account.company}`);
    assert((users.items ?? []).length === 7, `Numero utenti inatteso per ${account.company}`);
    assert((teams.items ?? []).length === 2, `Numero team inatteso per ${account.company}`);
    assert((orders.items ?? []).length === 0 && (invoices.items ?? []).length === 0, `Documenti commerciali inattesi per ${account.company}`);
    assert((tasks.items ?? []).length === 2 && (execution.items ?? []).length === 2, `Dati operativi inattesi per ${account.company}`);
    assert(catalogItems.length === 25, `Catalogo inatteso per ${account.company}`);

    await expectHidden(
      `${account.company} -> Demo planning`,
      await getPlanning(request(cookie, `/api/plannings/${demoPlanning._id}`), { params: Promise.resolve({ planningId: demoPlanning._id.toString() }) }),
    );
    await expectHidden(
      `${account.company} -> Demo customer`,
      await getCustomer(request(cookie, `/api/customers/${demoCustomer._id}`), { params: Promise.resolve({ customerId: demoCustomer._id.toString() }) }),
    );
    await expectHidden(
      `${account.company} -> Demo catalog`,
      await getCatalogItem(request(cookie, `/api/catalog-items/${demoCatalogItem._id}`), { params: Promise.resolve({ itemId: demoCatalogItem._id.toString() }) }),
    );
    if (demoInvoice) {
      await expectHidden(
        `${account.company} -> Demo invoice`,
        await getInvoice(request(cookie, `/api/invoices/${demoInvoice._id}`), { params: Promise.resolve({ invoiceId: demoInvoice._id.toString() }) }),
      );
    }
    if (demoExecution) {
      await expectHidden(
        `${account.company} -> Demo execution`,
        await getExecutionTask(request(cookie, `/api/execution-tasks/${demoExecution._id}`), { params: Promise.resolve({ taskId: demoExecution._id.toString() }) }),
      );
    }
    if (demoOrderPlanning?.orderId) {
      await expectHidden(
        `${account.company} -> Demo order`,
        await getOrder(request(cookie, `/api/orders/${encodeURIComponent(String(demoOrderPlanning.orderId))}`), { params: Promise.resolve({ orderId: String(demoOrderPlanning.orderId) }) }),
      );
    }
    if (demoTask && demoPlanning) {
      const filteredTasks = await callList(cookie, `/api/tasks?planningId=${demoPlanning._id}`, getTasks);
      assert((filteredTasks.items ?? []).length === 0, `${account.company} ha risolto un task Demo`);
    }

    ownObjects.push({
      companyId,
      planningId: String(planningItems[0]?.id),
      customerId: String(customerItems[0]?.id),
      catalogItemId: String(catalogItems[0]?.id),
    });
    reports.push({
      company: account.company,
      login: true,
      activeRole: me.session.activeRole,
      counts: {
        projects: planningItems.length,
        customers: customerItems.length,
        orders: (orders.items ?? []).length,
        invoices: (invoices.items ?? []).length,
        tasks: (tasks.items ?? []).length,
        execution: (execution.items ?? []).length,
        catalog: catalogItems.length,
      },
      demoObjectsHidden: true,
      trashScoped: Array.isArray(trash.items),
    });
  }

  for (let viewerIndex = 0; viewerIndex < ACCOUNTS.length; viewerIndex += 1) {
    const cookie = await authenticate(ACCOUNTS[viewerIndex].email);
    for (let ownerIndex = 0; ownerIndex < ownObjects.length; ownerIndex += 1) {
      if (viewerIndex === ownerIndex) continue;
      const foreign = ownObjects[ownerIndex];
      await expectHidden(
        `${ACCOUNTS[viewerIndex].company} -> ${ACCOUNTS[ownerIndex].company} planning`,
        await getPlanning(request(cookie, `/api/plannings/${foreign.planningId}`), { params: Promise.resolve({ planningId: foreign.planningId }) }),
      );
      await expectHidden(
        `${ACCOUNTS[viewerIndex].company} -> ${ACCOUNTS[ownerIndex].company} customer`,
        await getCustomer(request(cookie, `/api/customers/${foreign.customerId}`), { params: Promise.resolve({ customerId: foreign.customerId }) }),
      );
      await expectHidden(
        `${ACCOUNTS[viewerIndex].company} -> ${ACCOUNTS[ownerIndex].company} catalog item`,
        await getCatalogItem(request(cookie, `/api/catalog-items/${foreign.catalogItemId}`), { params: Promise.resolve({ itemId: foreign.catalogItemId }) }),
      );
    }
  }

  console.log(JSON.stringify({ ok: true, database: db.databaseName, reports, crossTenantDirectAccess: "blocked" }, null, 2));
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
