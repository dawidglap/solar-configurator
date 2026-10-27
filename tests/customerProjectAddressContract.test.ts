import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCustomerCreateDoc,
  normalizeCustomerDoc,
} from "../src/lib/customers";

async function loadNormalizeOrderFields() {
  process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/customer-project-address-unit-tests";
  return (await import("../src/lib/orders")).normalizeOrderFields;
}

test("distinct customer billing and project building addresses retain their domains", async () => {
  const normalizeOrderFields = await loadNormalizeOrderFields();
  const customerId = "customer-daniele-de-rossi";
  const storedCustomer = {
    _id: customerId,
    ...buildCustomerCreateDoc({
      type: "private",
      firstName: "Daniele",
      lastName: "De Rossi",
      street: "Oberstadt",
      streetNo: "6",
      zip: "8200",
      city: "Schaffhausen",
      country: "CH",
    }, "company-a"),
  };
  const storedPlanning = {
    _id: "planning-a",
    companyId: "company-a",
    customerId,
    projectType: "photovoltaic",
    propertyStreet: "Oberstadt",
    propertyHouseNumber: "6",
    propertyZip: "8200",
    propertyCity: "Schaffhausen",
    data: {
      profile: {
        buildingStreet: "Schachenstrasse",
        buildingStreetNo: "4",
        buildingZip: "9450",
        buildingCity: "Altstätten SG",
      },
    },
  };

  const customerGet = normalizeCustomerDoc(storedCustomer);
  const detailProfile = storedPlanning.data.profile;
  const listAliases = normalizeOrderFields(storedPlanning);

  assert.deepEqual(
    [customerGet.street, customerGet.streetNo, customerGet.zip, customerGet.city, customerGet.country],
    ["Oberstadt", "6", "8200", "Schaffhausen", "CH"],
  );
  assert.deepEqual(
    [
      detailProfile.buildingStreet,
      detailProfile.buildingStreetNo,
      detailProfile.buildingZip,
      detailProfile.buildingCity,
    ],
    ["Schachenstrasse", "4", "9450", "Altstätten SG"],
  );
  assert.deepEqual(
    [
      listAliases.propertyStreet,
      listAliases.propertyHouseNumber,
      listAliases.propertyZip,
      listAliases.propertyCity,
    ],
    ["Schachenstrasse", "4", "9450", "Altstätten SG"],
  );
  assert.deepEqual(
    [customerGet.buildingStreet, customerGet.buildingStreetNo, customerGet.buildingZip, customerGet.buildingCity],
    ["", "", "", ""],
  );
});

test("customer creation accepts canonical billing fields and does not rename billing aliases", () => {
  const canonical = buildCustomerCreateDoc({
    firstName: "Daniele",
    lastName: "De Rossi",
    street: "Oberstadt",
    streetNo: "6",
    zip: "8200",
    city: "Schaffhausen",
    country: "ch",
  }, "company-a");
  assert.deepEqual(
    [canonical.street, canonical.streetNo, canonical.zip, canonical.city, canonical.country, canonical.address],
    ["Oberstadt", "6", "8200", "Schaffhausen", "CH", "Oberstadt 6, 8200 Schaffhausen"],
  );

  const nonCanonicalAliases = buildCustomerCreateDoc({
    firstName: "Daniele",
    lastName: "De Rossi",
    billingStreet: "Oberstadt",
    billingStreetNo: "6",
    billingZip: "8200",
    billingCity: "Schaffhausen",
  }, "company-a");
  assert.deepEqual(
    [nonCanonicalAliases.street, nonCanonicalAliases.streetNo, nonCanonicalAliases.zip, nonCanonicalAliases.city],
    [null, null, null, null],
  );
});

test("creating projects for an existing customer cannot mutate its billing address", async () => {
  const normalizeOrderFields = await loadNormalizeOrderFields();
  const existingCustomer = buildCustomerCreateDoc({
    firstName: "Daniele",
    lastName: "De Rossi",
    street: "Oberstadt",
    streetNo: "6",
    zip: "8200",
    city: "Schaffhausen",
    country: "CH",
  }, "company-a");
  const before = JSON.stringify(existingCustomer);
  const projects = [
    { data: { profile: {
      buildingStreet: "Schachenstrasse",
      buildingStreetNo: "4",
      buildingZip: "9450",
      buildingCity: "Altstätten SG",
    } } },
    { data: { profile: {
      buildingStreet: "Im Moos",
      buildingStreetNo: "7",
      buildingZip: "9450",
      buildingCity: "Lüchingen",
    } } },
  ];

  assert.deepEqual(
    projects.map((planning) => {
      const aliases = normalizeOrderFields(planning);
      return [aliases.propertyStreet, aliases.propertyHouseNumber, aliases.propertyZip, aliases.propertyCity];
    }),
    [
      ["Schachenstrasse", "4", "9450", "Altstätten SG"],
      ["Im Moos", "7", "9450", "Lüchingen"],
    ],
  );
  assert.equal(JSON.stringify(existingCustomer), before);
});

test("route source keeps customer creation and planning profile persistence independent", () => {
  const customerCollectionRoute = readFileSync(
    new URL("../src/app/api/customers/route.ts", import.meta.url),
    "utf8",
  );
  const planningCollectionRoute = readFileSync(
    new URL("../src/app/api/plannings/route.ts", import.meta.url),
    "utf8",
  );
  const planningDetailRoute = readFileSync(
    new URL("../src/app/api/plannings/[planningId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(customerCollectionRoute, /buildCustomerCreateDoc\(body, session\.activeCompanyId\)/);
  assert.match(customerCollectionRoute, /\$setOnInsert:\s*{\s*\.\.\.doc,/);
  assert.match(planningCollectionRoute, /data: defaultStoreData\(\)/);
  assert.match(planningDetailRoute, /setObj\["data\.profile"\] = profile/);
  assert.doesNotMatch(planningDetailRoute, /customers\.(?:updateOne|findOneAndUpdate)/);
  assert.match(planningCollectionRoute, /companyId: session\.activeCompanyId/);
  assert.match(planningDetailRoute, /companyId: session\.activeCompanyId/);
});
