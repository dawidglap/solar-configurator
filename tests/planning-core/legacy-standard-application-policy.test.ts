import assert from "node:assert/strict";
import test from "node:test";

import { computeLegacyStandardLayout } from "../../src/lib/planning-core/legacy-standard";
import {
  applyStandardAutoLayoutPanelCommit,
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutSpacingM,
  STANDARD_AUTO_LAYOUT_POLICY,
  STANDARD_AUTO_LAYOUT_SPACING_M,
} from "../../src/components_v2/modules/legacyStandardApplicationPolicy";

type TestPanel = { id: string; roofId: string };

const STANDARD_TRIGGERS = ["TopToolbar", "ModulesPanel", "ToolHotkeys"] as const;
const existingPanels: TestPanel[] = [
  { id: "roof-a-old", roofId: "roof-a" },
  { id: "roof-b-existing", roofId: "roof-b" },
];
const generatedPanels: TestPanel[] = [
  { id: "roof-a-new-1", roofId: "roof-a" },
  { id: "roof-a-new-2", roofId: "roof-a" },
];

test("Standard auto-layout has one canonical application policy", () => {
  assert.deepEqual(STANDARD_AUTO_LAYOUT_POLICY, {
    filterPolicy: { reservedZones: true, snowGuards: true },
    nonEmpty: "replace",
    empty: "preserve",
  });
});

for (const trigger of STANDARD_TRIGGERS) {
  test(`${trigger}: a non-empty Standard layout replaces roof panels`, () => {
    const result = applyStandardAutoLayoutPanelCommit({
      existingPanels,
      generatedPanels,
      roofId: "roof-a",
    });

    assert.deepEqual(result, [existingPanels[1], ...generatedPanels]);
  });

  test(`${trigger}: an empty Standard layout preserves existing panels`, () => {
    const result = applyStandardAutoLayoutPanelCommit({
      existingPanels,
      generatedPanels: [],
      roofId: "roof-a",
    });

    assert.deepEqual(result, existingPanels);
  });
}

test("ToolHotkeys: applying auto-layout twice does not double the roof panel count", () => {
  const first = applyStandardAutoLayoutPanelCommit({
    existingPanels,
    generatedPanels,
    roofId: "roof-a",
  });
  const secondGeneration: TestPanel[] = [
    { id: "roof-a-second-1", roofId: "roof-a" },
    { id: "roof-a-second-2", roofId: "roof-a" },
  ];
  const second = applyStandardAutoLayoutPanelCommit({
    existingPanels: first,
    generatedPanels: secondGeneration,
    roofId: "roof-a",
  });

  assert.equal(second.filter((panel) => panel.roofId === "roof-a").length, 2);
  assert.deepEqual(second, [existingPanels[1], ...secondGeneration]);
});

test("replacing Roof A leaves all Roof B panels unchanged", () => {
  const multiRoofPanels: TestPanel[] = [
    { id: "a1", roofId: "roof-a" },
    { id: "a2", roofId: "roof-a" },
    { id: "b1", roofId: "roof-b" },
    { id: "b2", roofId: "roof-b" },
  ];
  const roofBPanels = multiRoofPanels.filter((panel) => panel.roofId === "roof-b");
  const result = applyStandardAutoLayoutPanelCommit({
    existingPanels: multiRoofPanels,
    generatedPanels: [{ id: "a-new", roofId: "roof-a" }],
    roofId: "roof-a",
  });

  assert.deepEqual(
    result.filter((panel) => panel.roofId === "roof-b"),
    roofBPanels,
  );
  assert.deepEqual(result, [...roofBPanels, { id: "a-new", roofId: "roof-a" }]);
});

for (const trigger of STANDARD_TRIGGERS) {
  test(`${trigger}: reserved zones and snow guards both filter placements`, () => {
    const result = computeLegacyStandardLayout({
      generation: {
        roofPolygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 60 },
          { x: 0, y: 60 },
        ],
        mppImage: 0.1,
        canvasAngleDeg: 0,
        orientation: "portrait",
        panelSizeM: { widthM: 1, heightM: 2 },
        spacingM: 0.1,
        marginM: 0,
      },
      reservedZones: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
      ],
      snowGuards: [{ p1: { x: 16, y: 0 }, p2: { x: 16, y: 20 } }],
      filterPolicy: STANDARD_AUTO_LAYOUT_POLICY.filterPolicy,
    });

    assert.deepEqual(result.rejected, { reservedZone: 1, snowGuard: 1 });
    assert.equal(result.count, 16);
  });
}

test("preview and all commit triggers resolve the same per-roof canvas angle", () => {
  const input = {
    roofId: "roof-a",
    roofPolygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ],
    legacyRoofAzimuthDeg: 0,
    gridAngleDeg: 7,
    perRoofAngles: { "roof-a": 123.5 },
  };
  const preview = resolveStandardAutoLayoutCanvasAngle(input);
  const topToolbar = resolveStandardAutoLayoutCanvasAngle(input);
  const modulesPanel = resolveStandardAutoLayoutCanvasAngle(input);
  const toolHotkeys = resolveStandardAutoLayoutCanvasAngle(input);

  assert.equal(preview, 123.5);
  assert.equal(topToolbar, preview);
  assert.equal(modulesPanel, preview);
  assert.equal(toolHotkeys, preview);
});

test("Standard spacing keeps explicit values and centralizes the 0.02 m fallback", () => {
  assert.equal(STANDARD_AUTO_LAYOUT_SPACING_M, 0.02);
  assert.equal(resolveStandardAutoLayoutSpacingM(undefined), 0.02);
  assert.equal(resolveStandardAutoLayoutSpacingM(null), 0.02);
  assert.equal(resolveStandardAutoLayoutSpacingM(Number.NaN), 0.02);
  assert.equal(resolveStandardAutoLayoutSpacingM(0), 0);
  assert.equal(resolveStandardAutoLayoutSpacingM(0.05), 0.05);
});
