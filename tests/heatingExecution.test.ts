import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXECUTION_STAGES,
  EXECUTION_TRACKS,
  getExecutionTracksForProjectType,
  normalizeExecutionRoles,
  normalizeExecutionTrack,
} from "../src/lib/executionTasks";

test("canonical execution tracks branch strictly by project type", () => {
  assert.deepEqual(EXECUTION_TRACKS, ["montage", "elektro", "heating"]);
  assert.deepEqual(getExecutionTracksForProjectType(undefined), ["montage", "elektro"]);
  assert.deepEqual(getExecutionTracksForProjectType("photovoltaic"), ["montage", "elektro"]);
  assert.deepEqual(getExecutionTracksForProjectType("heating"), ["heating"]);
  assert.throws(() => getExecutionTracksForProjectType("wind"), /Invalid projectType/);
});

test("Heating uses the generic role and lifecycle validators", () => {
  assert.equal(normalizeExecutionTrack("heating"), "heating");
  assert.deepEqual(normalizeExecutionRoles(["heating", "heating", "invalid"]), ["heating"]);
  assert.deepEqual(EXECUTION_STAGES, ["offen", "geplant", "in_ausfuehrung", "abgeschlossen"]);
});

test("Heating recovery is order-gated and bulk backfill remains PV-only", () => {
  const executionSource = readFileSync(
    new URL("../src/lib/executionTasks.ts", import.meta.url),
    "utf8",
  );
  const ensureStart = executionSource.indexOf("export async function ensureExecutionTasksForWonPlanning");
  const ensureEnd = executionSource.indexOf("export async function migrateExecutionWorkingDays", ensureStart);
  const ensureSource = executionSource.slice(ensureStart, ensureEnd);
  assert.match(ensureSource, /projectType === "heating"/);
  assert.match(ensureSource, /collection\("auftraege"\)\.findOne/);
  assert.match(ensureSource, /projectType: "heating"/);
  assert.match(ensureSource, /for \(const track of tracks\)/);

  const backfillStart = executionSource.indexOf("export async function backfillExecutionTasksForWonPlannings");
  const backfillEnd = executionSource.indexOf("export async function migrateMontagesToExecutionTasks", backfillStart);
  const backfillSource = executionSource.slice(backfillStart, backfillEnd);
  assert.match(backfillSource, /resolveProjectType\(planning\?\.projectType\) !== "photovoltaic"/);
});

test("canonical Heating order path retries the idempotent execution ensure without PV side effects", () => {
  const source = readFileSync(
    new URL("../src/app/api/plannings/[planningId]/generate-order/route.ts", import.meta.url),
    "utf8",
  );
  const helperStart = source.indexOf("async function ensureHeatingExecutionTaskForOrder");
  const helperEnd = source.indexOf("async function generateHeatingOrder", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /ensureExecutionTasksForWonPlanning/);
  assert.match(helper, /item\?\.track === "heating"/);
  assert.match(helper, /heatingTasks\.length !== 1/);

  const branchStart = source.indexOf("async function generateHeatingOrder");
  const branchEnd = source.indexOf("export async function OPTIONS", branchStart);
  const branch = source.slice(branchStart, branchEnd);
  assert.ok((branch.match(/ensureHeatingExecutionTaskForOrder/g) ?? []).length >= 3);
  assert.doesNotMatch(branch, /collection\(["']montages["']\)|createInvoicesForOrderIfMissing/);
});

test("existing execution APIs are generic and tenant-scoped", () => {
  const listSource = readFileSync(
    new URL("../src/app/api/execution-tasks/route.ts", import.meta.url),
    "utf8",
  );
  const itemSource = readFileSync(
    new URL("../src/app/api/execution-tasks/[taskId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(listSource, /normalizeExecutionTrack/);
  assert.match(listSource, /buildExecutionCompanyFilter\(companyId\)/);
  assert.match(itemSource, /buildExecutionCompanyFilter\(companyId\)/);
  assert.match(itemSource, /normalizeExecutionStage/);
  assert.match(itemSource, /scheduledStart/);
  assert.match(itemSource, /validateExecutionAssignees/);
});
