import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createLatestAddressRequestGuard,
  normalizeAddressAutocompleteQuery,
  shouldSearchAddress,
} from "../../src/components_v2/geocoding/addressAutocomplete";

test("address autocomplete starts from three meaningful characters", () => {
  assert.equal(shouldSearchAddress("F"), false);
  assert.equal(shouldSearchAddress("Fe"), false);
  assert.equal(shouldSearchAddress("Fel"), true);
  assert.equal(shouldSearchAddress("Feldstrasse"), true);
  assert.equal(shouldSearchAddress("Feldstrasse 15"), true);
});

test("address normalization preserves free text while making spaces and a terminal comma equivalent", () => {
  for (const value of [
    " Feldstrasse 15",
    "Feldstrasse 15 ",
    "Feldstrasse   15",
    "Feldstrasse 15,",
  ]) {
    assert.equal(normalizeAddressAutocompleteQuery(value), "Feldstrasse 15");
  }
  assert.equal(normalizeAddressAutocompleteQuery("Zürich"), "Zürich");
  assert.equal(normalizeAddressAutocompleteQuery("Luechingen"), "Luechingen");
});

test("progressive address input produces a searchable query at every meaningful step", () => {
  const queries = ["Feld", "Feldstrasse", "Feldstrasse 1", "Feldstrasse 15"];
  assert.deepEqual(
    queries.map((query) => shouldSearchAddress(query)),
    [true, true, true, true],
  );
  assert.equal(new Set(queries.map(normalizeAddressAutocompleteQuery)).size, 4);
});

test("latest address request wins when an older response arrives later", () => {
  const guard = createLatestAddressRequestGuard();
  const requestA = guard.begin();
  const requestB = guard.begin();
  assert.equal(guard.isCurrent(requestB), true);
  assert.equal(guard.isCurrent(requestA), false);
  guard.invalidate();
  assert.equal(guard.isCurrent(requestB), false);
});

test("GeoAdmin lifecycle uses normalized free text, debounce and abort without numeric client filtering", () => {
  const source = readFileSync(
    new URL("../../src/components_v2/geocoding/AddressSearchOSM.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /setTimeout\(async \(\) => \{/);
  assert.match(source, /\}, 250\)/);
  assert.match(source, /searchText=\$\{encodeURIComponent\(normalizedQuery\)\}/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.signal/);
  assert.match(source, /requestGuardRef\.current\.isCurrent\(requestId\)/);
  assert.equal(source.includes("capPrefix"), false);
  assert.equal(source.includes("houseInQuery"), false);
});
