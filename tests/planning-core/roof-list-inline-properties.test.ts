import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
  "utf8",
);
const roofListSource = source.slice(
  source.indexOf("data-roof-list-header"),
  source.indexOf('{step === "building" && panels.length > 0'),
);

test("roof list exposes explicit compact property columns without native number spinners", () => {
  for (const label of ["Dach", "Fläche", "Neigung", "Ausrichtung"]) {
    assert.ok(source.includes(`>${label}</div>`));
  }
  assert.ok(source.includes('type="text"'));
  assert.ok(source.includes('inputMode="decimal"'));
  assert.equal(source.includes('title="Neigung (°)"'), false);
});

test("inline editing selects and updates the clicked roof through canonical state", () => {
  assert.ok(source.includes("select(input.roofId)"));
  assert.ok(source.includes("updateRoof(roofId, { tiltDeg: v, surfacePlanning })"));
  assert.ok(source.includes("updateRoof(roofId, { fallAzimuthDeg: stored, surfacePlanning })"));
  assert.ok(source.includes("surface: { ...draft.config.surface, slopeDeg: v }"));
  assert.ok(source.includes("surface: { ...draft.config.surface, fallAzimuthDeg: stored }"));
});

test("flat roofs lock slope while direction keeps presets and custom mode", () => {
  assert.ok(source.includes('disabled: rowKind === "flat"'));
  assert.ok(source.includes('title={rowKind === "flat" ? "Flachdach: Neigung 0°"'));
  assert.ok(source.includes("ROOF_DIRECTION_CHOICES.map"));
  assert.ok(source.includes('<option value="custom">Benutzerdefiniert…</option>'));
  assert.ok(source.includes("normalizeRoofAzimuthDeg(raw)"));
});

test("large duplicate slope and direction control is not rendered", () => {
  assert.equal(source.includes("PitchedRoofSlopeControl"), false);
  assert.ok(source.includes("<RoofMarginControl roof={selectedRoof} />"));
});

test("building and module planning share one canonical roof-list structure", () => {
  assert.equal(source.match(/data-roof-list-header/g)?.length, 1);
  assert.equal(source.match(/data-roof-list-row/g)?.length, 1);
  assert.equal(roofListSource.includes('step === "building" ? (\n              <div'), false);
  for (const label of ["Dach", "Fläche", "Neigung", "Ausrichtung"]) {
    assert.ok(roofListSource.includes(`>${label}</div>`));
  }
  assert.equal(roofListSource.includes(">Dachfläche</div>"), false);
  assert.equal(roofListSource.includes("<span>Module</span>"), false);
  assert.equal(roofListSource.includes(">kWp</div>"), false);
});

test("flat, pitched and multiple roofs use the same canonical row values in both steps", () => {
  assert.ok(roofListSource.includes("layers.map((l, i) =>"));
  assert.equal(roofListSource.match(/<RoofAreaInfo/g)?.length, 1);
  assert.ok(roofListSource.includes('const tilt = rowKind === "flat"'));
  assert.ok(roofListSource.includes("resolveRoofFallAzimuth(l)"));
  assert.ok(roofListSource.includes("resolveRoofGeometricOrientationDeg(l.points"));
  assert.ok(roofListSource.includes("{tiltShort != null ? `${tiltShort}°` : \"—\"}"));
  assert.ok(roofListSource.includes("`${roofAzimuthCardinal(azShort)} · ${azShort}°`"));
});

test("module planning keeps roof selection but not building-only destructive actions", () => {
  assert.ok(roofListSource.includes("onClick={() => select(roofId)}"));
  assert.ok(roofListSource.includes('{step === "building" && ('));
  assert.ok(roofListSource.includes("delLayer(roofId)"));
});
