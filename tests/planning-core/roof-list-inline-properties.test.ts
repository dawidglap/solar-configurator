import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
  "utf8",
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
