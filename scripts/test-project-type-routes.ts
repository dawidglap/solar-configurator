import "dotenv/config";

import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { POST as login } from "@/app/api/auth/login/route";
import {
  GET as getPlanning,
  PATCH as updatePlanning,
} from "@/app/api/plannings/[planningId]/route";
import {
  GET as getPlannings,
  POST as createPlanning,
} from "@/app/api/plannings/route";
import { GET as getMe } from "@/app/api/me/route";
import { getDb, getMongoClient } from "@/lib/db";

const PASSWORD = "Demo12345";
const OWNER_EMAIL = "ivan@test-ivan.ch";
const FOREIGN_EMAIL = "roberto@test-roberto.ch";

async function responseJson(response: Response) {
  return response.json().catch(() => null) as Promise<any>;
}

async function authenticate(email: string) {
  const response = await login(new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  }));
  assert.equal(response.status, 200, `Login failed for ${email}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, `Missing session cookie for ${email}`);
  return cookie;
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

async function create(cookie: string, payload: Record<string, unknown>) {
  const response = await createPlanning(request(cookie, "/api/plannings", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  return { response, body: await responseJson(response) };
}

async function main() {
  const db = await getDb();
  const ownerCookie = await authenticate(OWNER_EMAIL);
  const foreignCookie = await authenticate(FOREIGN_EMAIL);
  const meResponse = await getMe(request(ownerCookie, "/api/me"));
  const me = await responseJson(meResponse);
  assert.equal(meResponse.status, 200);
  const companyId = String(me?.session?.activeCompanyId ?? "");
  assert.ok(companyId);

  const customerObjectId = new ObjectId();
  const customerId = customerObjectId.toString();
  const createdIds: ObjectId[] = [];
  const legacyId = new ObjectId();

  try {
    await db.collection("customers").insertOne({
      _id: customerObjectId,
      companyId,
      name: "Project type integration fixture",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("plannings").insertOne({
      _id: legacyId,
      companyId,
      customerId,
      title: "Project type legacy fixture",
      planningNumber: `TYPE-LEGACY-${Date.now()}`,
      status: "draft",
      currentStep: "profile",
      commercial: { stage: "lead", stageHistory: [] },
      summary: {},
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdIds.push(legacyId);

    const legacyResponse = await getPlanning(
      request(ownerCookie, `/api/plannings/${legacyId}`),
      { params: Promise.resolve({ planningId: String(legacyId) }) },
    );
    const legacyBody = await responseJson(legacyResponse);
    assert.equal(legacyResponse.status, 200);
    assert.equal(legacyBody?.planning?.projectType, "photovoltaic");
    const unchangedLegacy = await db.collection("plannings").findOne({ _id: legacyId });
    assert.equal("projectType" in (unchangedLegacy ?? {}), false);

    const missing = await create(ownerCookie, {
      customerId,
      title: "Project type default fixture",
    });
    assert.equal(missing.response.status, 200);
    assert.equal(missing.body?.projectType, "photovoltaic");
    createdIds.push(new ObjectId(String(missing.body.planningId)));

    const photovoltaic = await create(ownerCookie, {
      customerId,
      title: "Explicit photovoltaic fixture",
      projectType: "photovoltaic",
    });
    assert.equal(photovoltaic.response.status, 200);
    assert.equal(photovoltaic.body?.projectType, "photovoltaic");
    createdIds.push(new ObjectId(String(photovoltaic.body.planningId)));

    const heating = await create(ownerCookie, {
      customerId,
      title: "Explicit heating fixture",
      projectType: "heating",
    });
    assert.equal(heating.response.status, 200);
    assert.equal(heating.body?.projectType, "heating");
    const heatingId = String(heating.body.planningId);
    createdIds.push(new ObjectId(heatingId));

    const invalid = await create(ownerCookie, {
      customerId,
      projectType: "something-else",
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body?.error, "Invalid projectType");

    const stored = await db.collection("plannings").find({
      _id: { $in: createdIds.slice(1) },
      companyId,
    }).toArray();
    assert.equal(stored.length, 3);
    assert.deepEqual(
      stored.map((doc) => doc.projectType).sort(),
      ["heating", "photovoltaic", "photovoltaic"],
    );
    assert.ok(stored.every((doc) => doc.customerId === customerId));

    const listResponse = await getPlannings(request(ownerCookie, "/api/plannings?limit=500"));
    const listBody = await responseJson(listResponse);
    assert.equal(listResponse.status, 200);
    assert.equal(
      listBody.items.find((item: any) => item.id === heatingId)?.projectType,
      "heating",
    );

    const sameTypeResponse = await updatePlanning(
      request(ownerCookie, `/api/plannings/${heatingId}`, {
        method: "PATCH",
        body: JSON.stringify({ projectType: "heating" }),
      }),
      { params: Promise.resolve({ planningId: heatingId }) },
    );
    assert.equal(sameTypeResponse.status, 200);

    const changedTypeResponse = await updatePlanning(
      request(ownerCookie, `/api/plannings/${heatingId}`, {
        method: "PATCH",
        body: JSON.stringify({ projectType: "photovoltaic" }),
      }),
      { params: Promise.resolve({ planningId: heatingId }) },
    );
    assert.equal(changedTypeResponse.status, 409);

    const foreignListResponse = await getPlannings(request(foreignCookie, "/api/plannings?limit=500"));
    const foreignList = await responseJson(foreignListResponse);
    assert.equal(foreignListResponse.status, 200);
    assert.equal(foreignList.items.some((item: any) => item.id === heatingId), false);

    const foreignDetailResponse = await getPlanning(
      request(foreignCookie, `/api/plannings/${heatingId}`),
      { params: Promise.resolve({ planningId: heatingId }) },
    );
    assert.equal(foreignDetailResponse.status, 404);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      legacyFallback: "photovoltaic",
      createDefault: "photovoltaic",
      explicitTypes: ["photovoltaic", "heating"],
      immutable: true,
      sameCustomer: true,
      crossTenantHidden: true,
    }, null, 2)}\n`);
  } finally {
    await db.collection("plannings").deleteMany({
      _id: { $in: createdIds },
      companyId,
    });
    await db.collection("customers").deleteOne({
      _id: customerObjectId,
      companyId,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close().catch(() => undefined);
  });
