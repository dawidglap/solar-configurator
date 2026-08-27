import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlanningRouteLoadState,
  isPlannerReady,
  resolvePlannerUrlStep,
  resolvePlanningRouteStatus,
} from "../../src/components_v2/state/planning/plannerLoadState";

test("an unresolved direct planning route renders loading, never an unrelated functional step", () => {
  const loadState = createPlanningRouteLoadState("planning-a");
  const routeStatus = resolvePlanningRouteStatus({
    planningId: "planning-a",
    loadState,
  });
  assert.equal(routeStatus, "loading");
  assert.equal(isPlannerReady({ routeStatus, storeHydrated: false }), false);
});

test("a ready route still waits for store/planning hydration", () => {
  assert.equal(
    isPlannerReady({ routeStatus: "ready", storeHydrated: false }),
    false,
  );
  assert.equal(
    isPlannerReady({ routeStatus: "ready", storeHydrated: true }),
    true,
  );
});

test("a stale ready result from another planning cannot render during internal navigation", () => {
  const stale = { routeKey: "planning:planning-a", status: "ready" as const };
  assert.equal(
    resolvePlanningRouteStatus({ planningId: "planning-b", loadState: stale }),
    "loading",
  );
});

test("building and modules URL steps resolve before planner content is released", () => {
  assert.equal(resolvePlannerUrlStep({ step: "building" }), "building");
  assert.equal(resolvePlannerUrlStep({ currentStep: "modules" }), "modules");
  assert.equal(
    resolvePlannerUrlStep({ plannerStep: "modules", step: "building" }),
    "modules",
  );
});

test("loading transitions directly to planner-ready without a profile/customer render state", () => {
  const transitions = [
    createPlanningRouteLoadState("planning-a").status,
    "ready",
  ];
  assert.deepEqual(transitions, ["loading", "ready"]);
  assert.equal(transitions.includes("profile"), false);

  const pageSource = readFileSync(
    new URL("../../src/app/planner-v2/page.tsx", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL(
      "../../src/components_v2/layout/PlannerLoadingShell.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(pageSource.includes("plannerReady ?"));
  assert.ok(pageSource.includes("<PlannerLoadingShell"));
  assert.equal(pageSource.includes("setStep(requestedStep)"), false);
  assert.equal(pageSource.includes("ProfileStep"), false);
  assert.ok(shellSource.includes("bg-background"));
  assert.ok(shellSource.includes("backgroundColor: \"hsl(var(--background))\""));
  assert.equal(shellSource.includes("setTimeout"), false);
});

test("autosave ignores intermediate store mutations until hydration is complete", () => {
  const autoSaveSource = readFileSync(
    new URL(
      "../../src/components_v2/state/planning/useAutoSave.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(autoSaveSource.includes("if (!state.hydrationReady) return;"));
});
