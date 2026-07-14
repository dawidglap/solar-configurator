import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { GET as getCustomers, POST as createCustomer } from "../src/app/api/customers/route";
import { GET as getCustomerById, PATCH as patchCustomer } from "../src/app/api/customers/[customerId]/route";
import { getMongoClient } from "../src/lib/db";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `session=${payload}.${sign(payload, secret)}`;
}

const patchBody = {
  type: "private",
  salutation: "Herr",
  firstName: "webfast",
  lastName: "studio",
  phone: "787112727129",
  mobile: "518 480 50 0",
  email: "robi@baggio.com",
  street: "Jaśminowa",
  zip: "76-100",
  city: "41",
  buildingStreet: "Jaśminowa",
  buildingZip: "76-100",
  buildingCity: "41",
  source: "Empfehlung",
  tags: ["sas"],
  notes: "assasassa",
} as const;

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  const client = new MongoClient(uri);
  const companyId = new ObjectId().toString();
  const userId = new ObjectId().toString();
  const sessionCookie = buildSessionCookie(
    {
      userId,
      id: userId,
      firstName: "Test",
      lastName: "Admin",
      name: "Test Admin",
      email: "admin@example.com",
      activeCompanyId: companyId,
      role: "admin",
    },
    secret,
  );

  try {
    await client.connect();
    const db = client.db();

    await db.collection("companies").insertOne({
      _id: new ObjectId(companyId),
      name: "Customers Test Company",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const createReq = new Request("http://localhost/api/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        type: "private",
        firstName: "Initial",
        lastName: "Customer",
        email: "initial@example.com",
      }),
    });
    const createRes = await createCustomer(createReq);
    const createJson = await createRes.json();
    assert.equal(createRes.status, 200, `create failed: ${JSON.stringify(createJson)}`);

    const customerId = createJson?.customer?.id;
    assert.ok(customerId, "Missing created customer id");

    const patchReq = new Request(`http://localhost/api/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify(patchBody),
    });
    const patchRes = await patchCustomer(patchReq, {
      params: Promise.resolve({ customerId }),
    });
    const patchJson = await patchRes.json();
    assert.equal(patchRes.status, 200, `patch failed: ${JSON.stringify(patchJson)}`);

    const getDetailReq = new Request(`http://localhost/api/customers/${customerId}`, {
      method: "GET",
      headers: {
        cookie: sessionCookie,
      },
    });
    const getDetailRes = await getCustomerById(getDetailReq, {
      params: Promise.resolve({ customerId }),
    });
    const getDetailJson = await getDetailRes.json();
    assert.equal(getDetailRes.status, 200, `detail get failed: ${JSON.stringify(getDetailJson)}`);

    const customer = getDetailJson?.customer;
    assert.equal(customer?.salutation, patchBody.salutation);
    assert.equal(customer?.mobile, patchBody.mobile);
    assert.equal(customer?.street, patchBody.street);
    assert.equal(customer?.zip, patchBody.zip);
    assert.equal(customer?.city, patchBody.city);
    assert.equal(customer?.buildingStreet, patchBody.buildingStreet);
    assert.equal(customer?.buildingZip, patchBody.buildingZip);
    assert.equal(customer?.buildingCity, patchBody.buildingCity);
    assert.equal(customer?.source, patchBody.source);
    assert.deepEqual(customer?.tags, patchBody.tags);
    assert.equal(customer?.notes, patchBody.notes);
    assert.equal(customer?.address, "Jaśminowa, 76-100 41");

    const listReq = new Request("http://localhost/api/customers", {
      method: "GET",
      headers: {
        cookie: sessionCookie,
      },
    });
    const listRes = await getCustomers(listReq);
    const listJson = await listRes.json();
    assert.equal(listRes.status, 200, `list get failed: ${JSON.stringify(listJson)}`);
    const listed = (listJson?.items ?? []).find((item: any) => item.id === customerId);
    assert.ok(listed, "Patched customer not found in list");
    assert.equal(listed?.salutation, patchBody.salutation);
    assert.equal(listed?.mobile, patchBody.mobile);
    assert.equal(listed?.street, patchBody.street);
    assert.equal(listed?.buildingStreet, patchBody.buildingStreet);
    assert.deepEqual(listed?.tags, patchBody.tags);
    assert.equal(listed?.address, "Jaśminowa, 76-100 41");

    console.log("Customers route test passed.");
  } finally {
    await client.db().collection("customers").deleteMany({ companyId }).catch(() => {});
    await client.db().collection("companies").deleteOne({ _id: new ObjectId(companyId) }).catch(() => {});
    await getMongoClient().then((sharedClient) => sharedClient.close()).catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("test-customers-route failed:", error);
  process.exit(1);
});
