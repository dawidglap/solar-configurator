import assert from "node:assert/strict";
import {
  advanceAuftragSteps,
  AUFTRAG_LOCKED_FIRST_STEP,
  AUFTRAG_LOCKED_LAST_STEP,
  buildChecklistFromAuftragState,
  buildInitialAuftragStepStates,
  getDefaultAuftragPipelineSteps,
  getNextTemplateStepKey,
  isLockedTemplateStep,
} from "../src/lib/auftragPipeline";

const actor = {
  id: "test-user",
  fullName: "Test User",
};

function main() {
  const templateSteps = getDefaultAuftragPipelineSteps().slice(0, 4).map((step, index, all) => {
    if (index === 0) {
      return {
        ...step,
        key: AUFTRAG_LOCKED_FIRST_STEP.key,
        label: AUFTRAG_LOCKED_FIRST_STEP.label,
        order: 0,
        isLocked: true,
        isTerminal: false,
      };
    }
    if (index === all.length - 1) {
      return {
        ...step,
        key: AUFTRAG_LOCKED_LAST_STEP.key,
        label: AUFTRAG_LOCKED_LAST_STEP.label,
        order: index,
        isLocked: true,
        isTerminal: true,
      };
    }
    return {
      ...step,
      order: index,
      isLocked: false,
      isTerminal: false,
    };
  });

  assert.equal(templateSteps[0]?.key, AUFTRAG_LOCKED_FIRST_STEP.key);
  assert.equal(templateSteps.at(-1)?.key, AUFTRAG_LOCKED_LAST_STEP.key);
  assert.equal(isLockedTemplateStep(templateSteps, AUFTRAG_LOCKED_FIRST_STEP.key), true);
  assert.equal(isLockedTemplateStep(templateSteps, AUFTRAG_LOCKED_LAST_STEP.key), true);
  assert.equal(isLockedTemplateStep(templateSteps, templateSteps[1]?.key || ""), false);

  const initialState = buildInitialAuftragStepStates(templateSteps, actor, new Date("2026-01-02T03:04:05.000Z"));
  assert.equal(initialState[0]?.completedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(initialState[1]?.completedAt, null);

  const firstIntermediateKey = templateSteps[1]?.key || "";
  const secondIntermediateKey = templateSteps[2]?.key || "";
  const terminalKey = templateSteps[3]?.key || "";
  assert.equal(getNextTemplateStepKey(templateSteps, firstIntermediateKey), secondIntermediateKey);
  assert.equal(getNextTemplateStepKey(templateSteps, secondIntermediateKey), terminalKey);

  const advancedToSecond = advanceAuftragSteps({
    templateSteps,
    existingStepsState: initialState,
    toStepKey: secondIntermediateKey,
    actor,
    now: new Date("2026-01-03T00:00:00.000Z"),
  });
  assert.equal(advancedToSecond.currentStepKey, secondIntermediateKey);
  assert.equal(advancedToSecond.status, "aktiv");
  assert.ok(advancedToSecond.stepsState[0]?.completedAt);
  assert.ok(advancedToSecond.stepsState[1]?.completedAt);
  assert.equal(advancedToSecond.stepsState[2]?.completedAt, null);
  assert.equal(advancedToSecond.stepsState[3]?.completedAt, null);

  const rewoundToFirst = advanceAuftragSteps({
    templateSteps,
    existingStepsState: advancedToSecond.stepsState,
    toStepKey: firstIntermediateKey,
    actor,
    now: new Date("2026-01-04T00:00:00.000Z"),
  });
  assert.equal(rewoundToFirst.currentStepKey, firstIntermediateKey);
  assert.equal(rewoundToFirst.stepsState[0]?.completedAt, advancedToSecond.stepsState[0]?.completedAt);
  assert.equal(rewoundToFirst.stepsState[1]?.completedAt, null);
  assert.equal(rewoundToFirst.stepsState[2]?.completedAt, null);

  const advancedToTerminal = advanceAuftragSteps({
    templateSteps,
    existingStepsState: rewoundToFirst.stepsState,
    toStepKey: terminalKey,
    actor,
    now: new Date("2026-01-05T00:00:00.000Z"),
  });
  assert.equal(advancedToTerminal.currentStepKey, terminalKey);
  assert.equal(advancedToTerminal.status, "abgeschlossen");
  assert.ok(advancedToTerminal.stepsState[3]?.completedAt);

  const checklist = buildChecklistFromAuftragState({
    templateSteps,
    stepsState: advancedToTerminal.stepsState,
  });
  assert.equal(checklist.items.length, templateSteps.length);
  assert.equal(checklist.items[0]?.key, AUFTRAG_LOCKED_FIRST_STEP.key);
  assert.equal(checklist.items.at(-1)?.key, AUFTRAG_LOCKED_LAST_STEP.key);
  assert.equal(checklist.items.every((item) => item.done), true);

  console.log("Auftrag pipeline logic test passed.");
}

main();
