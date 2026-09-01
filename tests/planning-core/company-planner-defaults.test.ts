import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_COMPANY_PLANNER_DEFAULTS,
  COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
  resolveCompanyPlannerDefaults,
  resolveEffectiveModuleSpacingM,
  validateCompanyPlannerDefaults,
} from "../../src/lib/planning/companyPlannerDefaults";
import {
  canEditCompanyPlannerDefaults,
  getAuthenticatedCompanyId,
} from "../../src/lib/planning/companyPlannerPermissions";
import { K2_D_DOME_CONSTANTS_MM } from "../../src/lib/planning-core/advanced/k2-d-dome/constants";
import { K2_S_DOME_CONSTANTS_MM } from "../../src/lib/planning-core/advanced/k2-s-dome/constants";
import { computeLegacyStandardCandidates } from "../../src/lib/planning-core/legacy-standard";

const company = (horizontalMm: number, verticalMm: number) => ({
  schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
  moduleSpacing: { horizontalMm, verticalMm },
});

test("company planner defaults validate finite tenant values and use 19 mm fallback", () => {
  assert.deepEqual(
    resolveCompanyPlannerDefaults(undefined),
    BUILT_IN_COMPANY_PLANNER_DEFAULTS,
  );
  assert.equal(validateCompanyPlannerDefaults(company(19, 25)).valid, true);
  assert.equal(validateCompanyPlannerDefaults(company(-1, 25)).valid, false);
  assert.equal(validateCompanyPlannerDefaults(company(19, Number.NaN)).valid, false);
});

test("planning override wins over company default and company over fallback", () => {
  assert.deepEqual(
    resolveEffectiveModuleSpacingM({ company: company(25, 30) }),
    { horizontalM: 0.025, verticalM: 0.03 },
  );
  assert.deepEqual(
    resolveEffectiveModuleSpacingM({
      planning: { spacingM: 0.024 },
      company: company(19, 21),
    }),
    { horizontalM: 0.024, verticalM: 0.024 },
  );
  assert.deepEqual(
    resolveEffectiveModuleSpacingM({
      planning: { spacingM: 0.024, spacingXM: 0.025, spacingYM: 0.03 },
      company: company(18, 22),
    }),
    { horizontalM: 0.025, verticalM: 0.03 },
  );
});

test("different companies resolve independently without cross-tenant state", () => {
  assert.deepEqual(resolveEffectiveModuleSpacingM({ company: company(19, 19) }), {
    horizontalM: 0.019,
    verticalM: 0.019,
  });
  assert.deepEqual(resolveEffectiveModuleSpacingM({ company: company(25, 30) }), {
    horizontalM: 0.025,
    verticalM: 0.03,
  });
});

test("company setting permissions reuse owner/admin roles", () => {
  assert.equal(canEditCompanyPlannerDefaults({ activeRole: "owner" }), true);
  assert.equal(canEditCompanyPlannerDefaults({ activeRole: "admin" }), true);
  assert.equal(canEditCompanyPlannerDefaults({ activeRole: "planner" }), false);
  assert.equal(canEditCompanyPlannerDefaults({ activeRole: "viewer" }), false);
});

test("tenant identity is resolved only from the authenticated session", () => {
  assert.equal(
    getAuthenticatedCompanyId({ activeCompanyId: "company-a" }),
    "company-a",
  );
  assert.equal(getAuthenticatedCompanyId({}), null);
});

test("K2 official 18 mm repeat dimensions remain separate from 19 mm normal clamp default", () => {
  assert.equal(BUILT_IN_COMPANY_PLANNER_DEFAULTS.moduleSpacing.horizontalMm, 19);
  assert.equal(K2_D_DOME_CONSTANTS_MM.moduleLongSideSpacing, 18);
  assert.equal(K2_S_DOME_CONSTANTS_MM.moduleLongSideSpacing, 18);
});

test("legacy single spacing keeps old geometry while optional axes affect only their pitch", () => {
  const base = {
    roofPolygon: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ],
    mppImage: 0.01,
    canvasAngleDeg: 0,
    orientation: "portrait" as const,
    panelSizeM: { widthM: 1, heightM: 2 },
    spacingM: 0.1,
    marginM: 0,
  };
  const legacy = computeLegacyStandardCandidates(base);
  const explicitSame = computeLegacyStandardCandidates({
    ...base,
    spacingXM: 0.1,
    spacingYM: 0.1,
  });
  assert.deepEqual(explicitSame, legacy);

  const axes = computeLegacyStandardCandidates({
    ...base,
    spacingXM: 0.2,
    spacingYM: 0.3,
  });
  assert.ok(legacy.length > 2 && axes.length > 2);
  assert.notEqual(axes[1].cx - axes[0].cx, legacy[1].cx - legacy[0].cx);
  const firstSecondRowLegacy = legacy.find((panel) => panel.cy > legacy[0].cy);
  const firstSecondRowAxes = axes.find((panel) => panel.cy > axes[0].cy);
  assert.ok(firstSecondRowLegacy && firstSecondRowAxes);
  assert.notEqual(
    firstSecondRowAxes.cy - axes[0].cy,
    firstSecondRowLegacy.cy - legacy[0].cy,
  );
});

test("planner save/load preserves explicit horizontal and vertical overrides", async () => {
  const { usePlannerV2Store } = await import(
    "../../src/components_v2/state/plannerV2Store"
  );
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().setCompanyPlannerDefaults(company(21, 22), {
    initializePlanning: true,
  });
  usePlannerV2Store.getState().setModules({
    spacingM: 0.025,
    spacingXM: 0.025,
    spacingYM: 0.03,
  });
  const saved = JSON.parse(
    JSON.stringify(usePlannerV2Store.getState().exportState()),
  );

  usePlannerV2Store.getState().setCompanyPlannerDefaults(company(18, 20));
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().importState(saved);
  assert.equal(usePlannerV2Store.getState().modules.spacingXM, 0.025);
  assert.equal(usePlannerV2Store.getState().modules.spacingYM, 0.03);
  usePlannerV2Store.getState().resetPlanner();
});

test("changing company defaults does not mutate an initialized planning", async () => {
  const { usePlannerV2Store } = await import(
    "../../src/components_v2/state/plannerV2Store"
  );
  const store = usePlannerV2Store.getState();
  store.setCompanyPlannerDefaults(company(21, 22), { initializePlanning: true });
  assert.equal(usePlannerV2Store.getState().modules.spacingXM, 0.021);
  assert.equal(usePlannerV2Store.getState().modules.spacingYM, 0.022);

  usePlannerV2Store.getState().setCompanyPlannerDefaults(company(18, 20));
  assert.equal(usePlannerV2Store.getState().modules.spacingXM, 0.021);
  assert.equal(usePlannerV2Store.getState().modules.spacingYM, 0.022);

  usePlannerV2Store.getState().resetForNewAddress({});
  assert.equal(usePlannerV2Store.getState().modules.spacingXM, 0.018);
  assert.equal(usePlannerV2Store.getState().modules.spacingYM, 0.02);
  usePlannerV2Store.getState().resetPlanner();
});
