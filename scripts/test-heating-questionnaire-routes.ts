import "dotenv/config";

import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getMe } from "@/app/api/me/route";
import {
  GET as getQuestionnaire,
  PATCH as patchQuestionnaire,
} from "@/app/api/plannings/[planningId]/heating-questionnaire/route";
import { POST as duplicatePlanning } from "@/app/api/plannings/[planningId]/duplicate/route";
import { createEmptyHeatingQuestionnaire } from "@/lib/heatingQuestionnaire";
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

function routeParams(planningId: ObjectId | string) {
  return { params: Promise.resolve({ planningId: String(planningId) }) };
}

async function patch(cookie: string, planningId: ObjectId | string, body: unknown) {
  const response = await patchQuestionnaire(
    request(cookie, `/api/plannings/${planningId}/heating-questionnaire`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    routeParams(planningId),
  );
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

  const heatingId = new ObjectId();
  const photovoltaicId = new ObjectId();
  const createdIds = [heatingId, photovoltaicId];
  const now = new Date();

  try {
    await db.collection("plannings").insertMany([
      {
        _id: heatingId,
        companyId,
        projectType: "heating",
        title: "Heating questionnaire route fixture",
        planningNumber: `HEAT-FORM-${Date.now()}`,
        status: "draft",
        currentStep: "profile",
        untouchedFixture: { value: "must remain" },
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: photovoltaicId,
        companyId,
        projectType: "photovoltaic",
        title: "PV protection route fixture",
        planningNumber: `PV-FORM-${Date.now()}`,
        status: "draft",
        currentStep: "profile",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const emptyResponse = await getQuestionnaire(
      request(ownerCookie, `/api/plannings/${heatingId}/heating-questionnaire`),
      routeParams(heatingId),
    );
    const emptyBody = await responseJson(emptyResponse);
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(emptyBody.questionnaire, createEmptyHeatingQuestionnaire());
    const stillLegacy = await db.collection("plannings").findOne({ _id: heatingId });
    assert.equal("heating" in (stillLegacy ?? {}), false, "GET must not backfill legacy heating projects");

    const occupants = await patch(ownerCookie, heatingId, { occupants: 3 });
    assert.equal(occupants.response.status, 200);
    assert.equal(occupants.body.questionnaire.occupants, 3);

    const building = await patch(ownerCookie, heatingId, {
      projectSituation: "renovation",
      buildingType: "multi_family",
      heatedAreaM2: 420,
    });
    assert.equal(building.response.status, 200);

    const heating = await patch(ownerCookie, heatingId, {
      existingHeating: [
        {
          type: "heating_oil",
          annualConsumption: { value: 5_200, unit: "litres_per_year" },
          boilerYear: 2004,
        },
        {
          type: "firewood",
          annualConsumption: { value: 4, unit: "stere_per_year" },
          woodType: "Buche",
        },
      ],
    });
    assert.equal(heating.response.status, 200);

    const distribution = await patch(ownerCookie, heatingId, {
      heatDistribution: "both",
      documents: { floorPlan: "attached" },
    });
    assert.equal(distribution.response.status, 200);
    assert.equal(distribution.body.questionnaire.occupants, 3);
    assert.equal(distribution.body.questionnaire.buildingType, "multi_family");
    assert.equal(distribution.body.questionnaire.existingHeating.length, 2);
    assert.equal(distribution.body.questionnaire.heatDistribution, "both");

    const selected = await patch(ownerCookie, heatingId, {
      preferredHeatPumpVariants: ["ground_source", "air_water_outdoor"],
      existingDomesticHotWater: { options: ["heating", "solar_thermal"] },
    });
    assert.equal(selected.response.status, 200);
    const cleared = await patch(ownerCookie, heatingId, {
      preferredHeatPumpVariants: [],
      existingDomesticHotWater: { options: [] },
    });
    assert.equal(cleared.response.status, 200);
    assert.deepEqual(cleared.body.questionnaire.preferredHeatPumpVariants, []);
    assert.deepEqual(cleared.body.questionnaire.existingDomesticHotWater.options, []);
    assert.equal(cleared.body.questionnaire.occupants, 3);

    for (const invalid of [
      { buildingType: "castle" },
      { heatedAreaM2: -1 },
      { occupants: "3" },
      { existingHeating: [{ type: "gas" }] },
    ]) {
      const result = await patch(ownerCookie, heatingId, invalid);
      assert.equal(result.response.status, 400);
    }

    const pvUpdate = await patch(ownerCookie, photovoltaicId, { occupants: 2 });
    assert.equal(pvUpdate.response.status, 409);
    const storedPv = await db.collection("plannings").findOne({ _id: photovoltaicId });
    assert.equal("heating" in (storedPv ?? {}), false);

    const foreignRead = await getQuestionnaire(
      request(foreignCookie, `/api/plannings/${heatingId}/heating-questionnaire`),
      routeParams(heatingId),
    );
    assert.equal(foreignRead.status, 404);
    const foreignUpdate = await patch(foreignCookie, heatingId, { occupants: 99 });
    assert.equal(foreignUpdate.response.status, 404);

    const storedHeating = await db.collection("plannings").findOne({ _id: heatingId });
    assert.equal((storedHeating as any).untouchedFixture.value, "must remain");
    assert.equal((storedHeating as any).heating.questionnaire.occupants, 3);

    const duplicateResponse = await duplicatePlanning(
      request(ownerCookie, `/api/plannings/${heatingId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ title: "Heating questionnaire duplicate fixture" }),
      }),
      routeParams(heatingId),
    );
    const duplicateBody = await responseJson(duplicateResponse);
    assert.equal(duplicateResponse.status, 200);
    const duplicateId = new ObjectId(String(duplicateBody.planningId));
    createdIds.push(duplicateId);
    const duplicate = await db.collection("plannings").findOne({ _id: duplicateId, companyId });
    assert.equal(duplicate?.projectType, "heating");
    assert.deepEqual((duplicate as any)?.heating?.questionnaire, (storedHeating as any)?.heating?.questionnaire);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      legacyDefaultWithoutBackfill: true,
      partialAndIndependentUpdates: true,
      explicitArrayClear: true,
      pvProtected: true,
      tenantIsolated: true,
      unrelatedProjectDataPreserved: true,
      duplicateRetainsQuestionnaire: true,
    }, null, 2)}\n`);
  } finally {
    await db.collection("plannings").deleteMany({
      _id: { $in: createdIds },
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
