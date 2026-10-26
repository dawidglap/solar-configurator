import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isProjectType,
  resolveProjectType,
  resolveProjectTypeUpdate,
  type ProjectType,
} from "../src/lib/projectType";

async function loadNormalizeOrderFields() {
  process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/project-type-unit-tests";
  return (await import("../src/lib/orders")).normalizeOrderFields;
}

test("legacy project without projectType reads as photovoltaic without mutation", () => {
  const stored = { id: "legacy", title: "Bestandsprojekt" };
  const before = JSON.stringify(stored);

  assert.equal(resolveProjectType((stored as any).projectType), "photovoltaic");
  assert.equal(JSON.stringify(stored), before);
  assert.equal("projectType" in stored, false);
});

test("existing create payload without projectType defaults to photovoltaic", () => {
  const productionPayload = { title: "Neues Projekt" };
  assert.equal(resolveProjectType((productionPayload as any).projectType), "photovoltaic");
});

test("explicit photovoltaic and heating values remain canonical", () => {
  assert.equal(resolveProjectType("photovoltaic"), "photovoltaic");
  assert.equal(resolveProjectType("heating"), "heating");
});

test("non-canonical project types are rejected instead of normalized", () => {
  for (const value of ["pv", "solar", "heizung", "heat", "other", "something-else", " Heating ", null]) {
    assert.equal(isProjectType(value), false);
    assert.throws(() => resolveProjectType(value), /Invalid projectType/);
  }
});

test("projectType is immutable after creation while the same value is harmless", () => {
  assert.deepEqual(resolveProjectTypeUpdate("photovoltaic", undefined, false), {
    ok: true,
    projectType: "photovoltaic",
    provided: false,
  });
  assert.deepEqual(resolveProjectTypeUpdate(undefined, "photovoltaic", true), {
    ok: true,
    projectType: "photovoltaic",
    provided: true,
  });
  assert.deepEqual(resolveProjectTypeUpdate("heating", "heating", true), {
    ok: true,
    projectType: "heating",
    provided: true,
  });
  assert.deepEqual(resolveProjectTypeUpdate("photovoltaic", "heating", true), {
    ok: false,
    reason: "immutable",
  });
  assert.deepEqual(resolveProjectTypeUpdate("heating", "photovoltaic", true), {
    ok: false,
    reason: "immutable",
  });
});

test("one customer can own separate photovoltaic and heating projects", () => {
  const customerId = "customer-x";
  const projects: Array<{ id: string; customerId: string; projectType: ProjectType }> = [
    { id: "project-pv", customerId, projectType: resolveProjectType("photovoltaic") },
    { id: "project-heating", customerId, projectType: resolveProjectType("heating") },
  ];

  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map((project) => project.projectType), ["photovoltaic", "heating"]);
  assert.ok(projects.every((project) => project.customerId === customerId));
});

test("project routes retain authenticated company scoping and expose canonical projectType", () => {
  const collectionRoute = readFileSync(
    new URL("../src/app/api/plannings/route.ts", import.meta.url),
    "utf8",
  );
  const detailRoute = readFileSync(
    new URL("../src/app/api/plannings/[planningId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(collectionRoute, /companyId: session\.activeCompanyId/);
  assert.match(detailRoute, /companyId: session\.activeCompanyId/);
  assert.match(collectionRoute, /projectType: resolveProjectType\(d\.projectType\)/);
  assert.match(detailRoute, /projectType: resolveProjectType\(\(doc as any\)\?\.projectType\)/);
});

test("planning list projection preserves canonical project address fallback fields", () => {
  const collectionRoute = readFileSync(
    new URL("../src/app/api/plannings/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(collectionRoute, /"data\.profile\.buildingStreet": 1/);
  assert.match(collectionRoute, /"data\.profile\.buildingStreetNo": 1/);
  assert.match(collectionRoute, /"data\.profile\.buildingZip": 1/);
  assert.match(collectionRoute, /"data\.profile\.buildingCity": 1/);
  assert.match(collectionRoute, /companyId: session\.activeCompanyId/);
  assert.match(collectionRoute, /filter\.customerId = customerId/);
});

test("planning list addresses stay project-specific for multiple projects of one customer", async () => {
  const normalizeOrderFields = await loadNormalizeOrderFields();
  const customerId = "customer-with-three-sites";
  const projects = [
    {
      customerId,
      projectType: "photovoltaic",
      data: {
        profile: {
          buildingStreet: "Erlenstrasse",
          buildingStreetNo: "2b",
          buildingZip: "9435",
          buildingCity: "Heerbrugg",
        },
      },
    },
    {
      customerId,
      projectType: "heating",
      data: {
        profile: {
          buildingStreet: "Schachenstrasse",
          buildingStreetNo: "4",
          buildingZip: "9450",
          buildingCity: "Lüchingen",
        },
      },
    },
    {
      customerId,
      projectType: "photovoltaic",
      data: {
        profile: {
          buildingStreet: "Im Moos",
          buildingStreetNo: "7",
          buildingZip: "9450",
          buildingCity: "Lüchingen",
        },
      },
    },
  ];

  assert.deepEqual(
    projects.map((project) => {
      const address = normalizeOrderFields(project);
      return [
        address.propertyStreet,
        address.propertyHouseNumber,
        address.propertyZip,
        address.propertyCity,
      ];
    }),
    [
      ["Erlenstrasse", "2b", "9435", "Heerbrugg"],
      ["Schachenstrasse", "4", "9450", "Lüchingen"],
      ["Im Moos", "7", "9450", "Lüchingen"],
    ],
  );
});

test("planning address normalization keeps legacy precedence and never uses customer billing data", async () => {
  const normalizeOrderFields = await loadNormalizeOrderFields();
  const normalized = normalizeOrderFields({
    projectType: "heating",
    propertyStreet: "Legacyweg",
    propertyHouseNumber: "9a",
    propertyZip: "9000",
    propertyCity: "St. Gallen",
    data: {
      profile: {
        buildingStreet: "Nestedweg",
        buildingStreetNo: "12",
        buildingZip: "9450",
        buildingCity: "Lüchingen",
      },
    },
    customer: {
      buildingStreet: "Billingstrasse",
      buildingStreetNo: "99",
      buildingZip: "8000",
      buildingCity: "Zürich",
    },
  });

  assert.deepEqual(
    [
      normalized.propertyStreet,
      normalized.propertyHouseNumber,
      normalized.propertyZip,
      normalized.propertyCity,
    ],
    ["Legacyweg", "9a", "9000", "St. Gallen"],
  );

  const missing = normalizeOrderFields({
    projectType: "photovoltaic",
    customer: {
      buildingStreet: "Billingstrasse",
      buildingStreetNo: "99",
      buildingZip: "8000",
      buildingCity: "Zürich",
    },
  });
  assert.deepEqual(
    [missing.propertyStreet, missing.propertyHouseNumber, missing.propertyZip, missing.propertyCity],
    [null, null, null, null],
  );
});
