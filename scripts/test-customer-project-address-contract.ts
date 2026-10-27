import "dotenv/config";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

const configuredUri = process.env.MONGODB_URI;
assert.ok(configuredUri, "Missing MONGODB_URI");

const isolatedUri = new URL(configuredUri);
isolatedUri.pathname = "/sola_codex_address_contract_test";
process.env.MONGODB_URI = isolatedUri.toString();
process.env.SESSION_SECRET = "customer-project-address-contract-secret";

function buildSessionCookie(session: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("hex");
  return `session=${payload}.${signature}`;
}

function request(cookie: string, path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function responseJson(response: Response) {
  return response.json().catch(() => null) as Promise<any>;
}

async function main() {
  const [
    { getDb, getMongoClient },
    { GET: getCustomers, POST: createCustomer },
    { GET: getCustomer },
    { GET: getPlannings, POST: createPlanning },
    { GET: getPlanning, PATCH: updatePlanning },
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../src/app/api/customers/route"),
    import("../src/app/api/customers/[customerId]/route"),
    import("../src/app/api/plannings/route"),
    import("../src/app/api/plannings/[planningId]/route"),
  ]);

  const db = await getDb();
  const companyObjectId = new ObjectId();
  const companyId = companyObjectId.toString();
  const cookie = buildSessionCookie({
    userId: new ObjectId().toString(),
    activeCompanyId: companyId,
    activeRole: "owner",
    name: "Address Contract Test",
    isServiceSession: true,
  });
  const planningIds: ObjectId[] = [];
  let customerId = "";

  try {
    await db.collection("companies").insertOne({
      _id: companyObjectId,
      name: "Address Contract Test Company",
      plan: "starter",
      subscriptionStatus: "active",
      validUntil: new Date(Date.now() + 86_400_000),
      maxUsers: 5,
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const customerResponse = await createCustomer(request(cookie, "/api/customers", {
      method: "POST",
      body: JSON.stringify({
        type: "private",
        firstName: "Daniele",
        lastName: "De Rossi",
        street: "Oberstadt",
        streetNo: "6",
        zip: "8200",
        city: "Schaffhausen",
        country: "CH",
      }),
    }));
    const customerBody = await responseJson(customerResponse);
    assert.equal(customerResponse.status, 200, JSON.stringify(customerBody));
    assert.equal(customerBody?.deduped, false);
    customerId = String(customerBody?.customer?.id ?? "");
    assert.ok(customerId);

    const createPlanningResponse = await createPlanning(request(cookie, "/api/plannings", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        projectType: "photovoltaic",
        title: "Daniele De Rossi – Schachenstrasse",
      }),
    }));
    const createPlanningBody = await responseJson(createPlanningResponse);
    assert.equal(createPlanningResponse.status, 200, JSON.stringify(createPlanningBody));
    const planningId = String(createPlanningBody?.planningId ?? "");
    assert.ok(planningId);
    planningIds.push(new ObjectId(planningId));

    const profile = {
      contactFirstName: "Daniele",
      contactLastName: "De Rossi",
      buildingStreet: "Schachenstrasse",
      buildingStreetNo: "4",
      buildingZip: "9450",
      buildingCity: "Altstätten SG",
    };
    const updatePlanningResponse = await updatePlanning(
      request(cookie, `/api/plannings/${planningId}`, {
        method: "PATCH",
        body: JSON.stringify({ profile }),
      }),
      { params: Promise.resolve({ planningId }) },
    );
    const updatePlanningBody = await responseJson(updatePlanningResponse);
    assert.equal(updatePlanningResponse.status, 200, JSON.stringify(updatePlanningBody));

    const customerGetResponse = await getCustomer(
      request(cookie, `/api/customers/${customerId}`),
      { params: Promise.resolve({ customerId }) },
    );
    const customerGetBody = await responseJson(customerGetResponse);
    assert.equal(customerGetResponse.status, 200, JSON.stringify(customerGetBody));
    assert.deepEqual(
      [
        customerGetBody?.customer?.street,
        customerGetBody?.customer?.streetNo,
        customerGetBody?.customer?.zip,
        customerGetBody?.customer?.city,
      ],
      ["Oberstadt", "6", "8200", "Schaffhausen"],
    );

    const planningGetResponse = await getPlanning(
      request(cookie, `/api/plannings/${planningId}`),
      { params: Promise.resolve({ planningId }) },
    );
    const planningGetBody = await responseJson(planningGetResponse);
    assert.equal(planningGetResponse.status, 200, JSON.stringify(planningGetBody));
    const storedProfile = planningGetBody?.planning?.data?.profile;
    assert.deepEqual(
      [storedProfile?.buildingStreet, storedProfile?.buildingStreetNo, storedProfile?.buildingZip],
      ["Schachenstrasse", "4", "9450"],
    );
    const resolvedProjectCity = String(storedProfile?.buildingCity ?? "");
    assert.ok(resolvedProjectCity);
    assert.notEqual(resolvedProjectCity, "Schaffhausen");

    const planningListResponse = await getPlannings(
      request(cookie, `/api/plannings?customerId=${encodeURIComponent(customerId)}`),
    );
    const planningListBody = await responseJson(planningListResponse);
    assert.equal(planningListResponse.status, 200, JSON.stringify(planningListBody));
    const listed = planningListBody?.items?.find((item: any) => item.id === planningId);
    assert.ok(listed);
    assert.deepEqual(
      [listed.propertyStreet, listed.propertyHouseNumber, listed.propertyZip],
      ["Schachenstrasse", "4", "9450"],
    );
    assert.equal(listed.propertyCity, resolvedProjectCity);

    const customerBeforeExistingProject = await db.collection("customers").findOne({
      _id: new ObjectId(customerId),
      companyId,
    });
    const secondPlanningResponse = await createPlanning(request(cookie, "/api/plannings", {
      method: "POST",
      body: JSON.stringify({ customerId, title: "Existing customer project" }),
    }));
    const secondPlanningBody = await responseJson(secondPlanningResponse);
    assert.equal(secondPlanningResponse.status, 200, JSON.stringify(secondPlanningBody));
    planningIds.push(new ObjectId(String(secondPlanningBody.planningId)));
    const customerAfterExistingProject = await db.collection("customers").findOne({
      _id: new ObjectId(customerId),
      companyId,
    });
    for (const field of ["street", "streetNo", "zip", "city", "country"] as const) {
      assert.equal(customerAfterExistingProject?.[field], customerBeforeExistingProject?.[field]);
    }

    const customerListResponse = await getCustomers(request(cookie, "/api/customers"));
    assert.equal(customerListResponse.status, 200);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      database: "isolated-test-database",
      customerBilling: "Oberstadt 6, 8200 Schaffhausen",
      requestedProjectBuilding: "Schachenstrasse 4, 9450 Altstätten SG",
      persistedProjectBuilding: `Schachenstrasse 4, 9450 ${resolvedProjectCity}`,
      listUsesProjectAddress: true,
      existingCustomerUnchanged: true,
    }, null, 2)}\n`);
  } finally {
    await db.collection("plannings").deleteMany({ _id: { $in: planningIds }, companyId }).catch(() => {});
    if (customerId) {
      await db.collection("customers").deleteOne({ _id: new ObjectId(customerId), companyId }).catch(() => {});
    }
    await db.collection("companies").deleteOne({ _id: companyObjectId }).catch(() => {});
    const client = await getMongoClient().catch(() => null);
    await client?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("test-customer-project-address-contract failed:", error);
  process.exitCode = 1;
});
