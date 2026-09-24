import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const toolbar = readFileSync(
  new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
  "utf8",
);
const stats = readFileSync(
  new URL("../../src/components_v2/ui/ProjectStatsBar.tsx", import.meta.url),
  "utf8",
);
const separator = readFileSync(
  new URL(
    "../../src/components_v2/layout/TopToolbar/ToolbarSeparator.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("top toolbar uses one shared visual separator", () => {
  assert.match(separator, /mx-2 h-4 w-px shrink-0 self-center bg-white/);
  assert.equal((toolbar.match(/<ToolbarSeparator \/>/g) ?? []).length, 2);
  assert.equal((stats.match(/<ToolbarSeparator \/>/g) ?? []).length, 2);
});

test("undo and redo remain one group without an internal separator", () => {
  const historyGroup = toolbar.match(
    /<div className="flex items-center gap-2">([\s\S]*?)<\/div>/,
  )?.[1];

  assert.ok(historyGroup);
  assert.match(historyGroup, /ariaLabel="Rückgängig"/);
  assert.match(historyGroup, /ariaLabel="Wiederholen"/);
  assert.doesNotMatch(historyGroup, /ToolbarSeparator/);
});

test("stats do not introduce borders or textual pipe separators", () => {
  assert.doesNotMatch(stats, /border-l/);
  assert.doesNotMatch(stats, />\s*\|\s*</);
});
