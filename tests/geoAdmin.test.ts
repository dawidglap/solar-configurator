import assert from "node:assert/strict";
import test from "node:test";
import {
  extractParcelNumber,
  normalizeLv95Coordinates,
  objectAddressChanged,
  parseGeoAdminAddress,
} from "../src/lib/geoAdmin";

test("normalizes GeoAdmin SearchServer's swapped LV95 axes", () => {
  assert.deepEqual(normalizeLv95Coordinates({ x: 1_250_342.5, y: 2_759_996.75 }), {
    easting: 2_759_996.75,
    northing: 1_250_342.5,
  });
  assert.deepEqual(normalizeLv95Coordinates({ x: 2_759_996.75, y: 1_250_342.5 }), {
    easting: 2_759_996.75,
    northing: 1_250_342.5,
  });
});

test("parses the normalized address label", () => {
  assert.deepEqual(
    parseGeoAdminAddress(
      { label: "Schachenstrasse 4 <b>9450 Lüchingen</b>", num: 4 },
      { street: "", houseNumber: "", zip: "", city: "" },
    ),
    {
      addressStreet: "Schachenstrasse",
      addressHouseNumber: "4",
      addressZip: "9450",
      addressCity: "Lüchingen",
    },
  );
  assert.deepEqual(
    parseGeoAdminAddress(
      { detail: "schachenstrasse 4 9450 luechingen 3251 altstaetten ch sg", num: 4 },
      { street: "Schachenstrasse", houseNumber: "4", zip: "9450", city: "Lüchingen" },
    ),
    {
      addressStreet: "schachenstrasse",
      addressHouseNumber: "4",
      addressZip: "9450",
      addressCity: "Lüchingen",
    },
  );
});

test("extracts cantonal parcel number variants", () => {
  assert.equal(extractParcelNumber({ number: "1042" }), "1042");
  assert.equal(extractParcelNumber({ Parzellennummer: "88-A" }), "88-A");
  assert.equal(extractParcelNumber({ lparz: 3054 }), "3054");
});

test("address comparison ignores casing and repeated whitespace", () => {
  assert.equal(
    objectAddressChanged(
      { street: "Schachenstrasse", houseNumber: "4", zip: "9450", city: "Lüchingen" },
      { street: " schachenstrasse ", houseNumber: "4", zip: "9450", city: "LÜCHINGEN" },
    ),
    false,
  );
});
