import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHeatingQuestionnairePatch,
  buildHeatingQuestionnaireSet,
  createEmptyHeatingQuestionnaire,
  normalizeHeatingQuestionnaire,
  parseHeatingQuestionnairePatch,
} from "../src/lib/heatingQuestionnaire";

test("missing questionnaire normalizes to a complete empty representation without mutation", () => {
  assert.deepEqual(normalizeHeatingQuestionnaire(undefined), createEmptyHeatingQuestionnaire());
  assert.deepEqual(normalizeHeatingQuestionnaire(null), createEmptyHeatingQuestionnaire());
});

test("partial progress accepts occupants without requiring any other answer", () => {
  const patch = parseHeatingQuestionnairePatch({ occupants: 3 });
  const questionnaire = applyHeatingQuestionnairePatch(undefined, patch);

  assert.equal(questionnaire.occupants, 3);
  assert.equal(questionnaire.buildingType, null);
  assert.deepEqual(questionnaire.existingHeating, []);
});

test("independent nested patches retain previously saved sections", () => {
  let questionnaire = applyHeatingQuestionnairePatch(undefined, parseHeatingQuestionnairePatch({
    buildingType: "single_family",
    heatedAreaM2: 185,
    heatLoadCalculation: { available: true, kw: 9.7 },
  }));
  questionnaire = applyHeatingQuestionnairePatch(questionnaire, parseHeatingQuestionnairePatch({
    existingHeating: [{
      type: "natural_gas",
      annualConsumption: { value: 24_000, unit: "kwh_per_year" },
      deviceYear: 2008,
    }],
  }));
  questionnaire = applyHeatingQuestionnairePatch(questionnaire, parseHeatingQuestionnairePatch({
    heatDistribution: "radiators",
  }));

  assert.equal(questionnaire.buildingType, "single_family");
  assert.equal(questionnaire.heatLoadCalculation.kw, 9.7);
  assert.equal(questionnaire.existingHeating[0]?.type, "natural_gas");
  assert.equal(questionnaire.heatDistribution, "radiators");
});

test("explicit empty arrays clear selections without affecting other answers", () => {
  const current = applyHeatingQuestionnairePatch(undefined, parseHeatingQuestionnairePatch({
    occupants: 2,
    preferredHeatPumpVariants: ["ground_source", "air_water_outdoor"],
    existingDomesticHotWater: {
      options: ["heating", "solar_thermal"],
      otherDescription: "Bestand",
    },
  }));
  const cleared = applyHeatingQuestionnairePatch(current, parseHeatingQuestionnairePatch({
    preferredHeatPumpVariants: [],
    existingDomesticHotWater: { options: [] },
  }));

  assert.deepEqual(cleared.preferredHeatPumpVariants, []);
  assert.deepEqual(cleared.existingDomesticHotWater.options, []);
  assert.equal(cleared.existingDomesticHotWater.otherDescription, "Bestand");
  assert.equal(cleared.occupants, 2);
});

test("database operations address only supplied questionnaire leaves", () => {
  const set = buildHeatingQuestionnaireSet(parseHeatingQuestionnairePatch({
    heatLoadCalculation: { kw: 11 },
    documents: { floorPlan: "attached" },
  }));

  assert.deepEqual(set, {
    "heating.questionnaire.heatLoadCalculation.kw": 11,
    "heating.questionnaire.documents.floorPlan": "attached",
  });
  assert.equal("heating.questionnaire" in set, false);
});

test("canonical model covers variants, installation data, checklist and trimmed notes", () => {
  const questionnaire = applyHeatingQuestionnairePatch(undefined, parseHeatingQuestionnairePatch({
    projectSituation: "heating_replacement",
    preferredHeatPumpVariants: ["ground_source", "air_water_indoor"],
    groundSource: {
      existingBorehole: { status: "yes", count: 2, depthPerBoreholeM: 135 },
      notes: "  Bestand prüfen  ",
    },
    airWaterIndoor: {
      installationType: "special",
      installationRoom: { lengthM: 4.2, widthM: 3.1, heightM: 2.4 },
      plannedAirRouting: ["light_well", "upwards"],
      distanceToNearestNoiseSensitiveWindowM: 0,
      specialInstallationDescription: "  Schacht beachten  ",
    },
    documents: {
      floorPlan: "attached",
      excavationOrBoreholeDocuments: "will_follow",
    },
    additionalNotes: "  Rückruf erwünscht  ",
  }));

  assert.equal(questionnaire.groundSource.notes, "Bestand prüfen");
  assert.deepEqual(questionnaire.airWaterIndoor.plannedAirRouting, ["light_well", "upwards"]);
  assert.equal(questionnaire.airWaterIndoor.distanceToNearestNoiseSensitiveWindowM, 0);
  assert.equal(questionnaire.documents.floorPlan, "attached");
  assert.equal(questionnaire.additionalNotes, "Rückruf erwünscht");
});

test("invalid enums, numbers, strings, duplicates and unrelated keys are rejected", () => {
  const invalid = [
    { buildingType: "castle" },
    { occupants: -1 },
    { occupants: 1.5 },
    { occupants: "3" },
    { heatedAreaM2: 0 },
    { heatedAreaM2: Number.NaN },
    { preferredHeatPumpVariants: ["ground_source", "ground_source"] },
    { existingHeating: [{ type: "heating_oil", annualConsumption: { value: 100, unit: "kwh_per_year" } }] },
    { additionalNotes: "x".repeat(10_001) },
    { unrelatedProjectField: true },
  ];

  for (const value of invalid) {
    assert.throws(() => parseHeatingQuestionnairePatch(value));
  }
});

test("nulls remain explicit canonical answers and are not converted from strings", () => {
  const patch = parseHeatingQuestionnairePatch({
    heatedAreaM2: null,
    heatLoadCalculation: { available: null, kw: null },
    domesticHotWaterWithNewHeatPump: null,
  });
  assert.deepEqual(patch, {
    heatedAreaM2: null,
    heatLoadCalculation: { available: null, kw: null },
    domesticHotWaterWithNewHeatPump: null,
  });
  assert.throws(() => parseHeatingQuestionnairePatch({ heatedAreaM2: "120" }));
});
