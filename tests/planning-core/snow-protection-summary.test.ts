import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSnowProtectionSummaryFromPlanning,
  snowProtectionSegmentLengthM,
  summarizeSnowProtection,
  withSnowProtectionSummary,
} from "../../src/lib/planning/snowProtectionSummary";

type Guard = {
  id: string;
  roofId: string;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  lengthM?: number;
  pricePerM?: number;
};

function guard(
  id: string,
  roofId: string,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): Guard {
  return { id, roofId, p1, p2 };
}

function planningDocument(input: {
  guards?: Guard[];
  roofIds?: string[];
  mppImage?: number;
  view?: Record<string, number>;
  persistedSummary?: unknown;
}) {
  return {
    summary: input.persistedSummary,
    data: {
      planner: {
        layers: (input.roofIds ?? []).map((id) => ({ id })),
        snowGuards: input.guards ?? [],
        snapshot: { mppImage: input.mppImage },
        view: input.view,
      },
    },
  };
}

test("no Schneefang resolves to zero metres", () => {
  assert.deepEqual(
    summarizeSnowProtection({ snowGuards: [], mppImage: 0.1 }),
    { totalLengthM: 0, byRoof: [] },
  );
});

test("one geometric 5 m Schneefang resolves to 5 m", () => {
  const segment = guard("sg-1", "roof-1", { x: 10, y: 10 }, { x: 40, y: 50 });
  assert.equal(snowProtectionSegmentLengthM(segment, 0.1), 5);
  assert.deepEqual(
    summarizeSnowProtection({ snowGuards: [segment], mppImage: 0.1 }),
    {
      totalLengthM: 5,
      byRoof: [{ roofId: "roof-1", lengthM: 5 }],
    },
  );
});

test("multiple segments aggregate on the same roof without premature rounding", () => {
  const summary = summarizeSnowProtection({
    snowGuards: [
      guard("sg-1", "roof-1", { x: 0, y: 0 }, { x: 1, y: 1 }),
      guard("sg-2", "roof-1", { x: 0, y: 0 }, { x: 2, y: 2 }),
    ],
    mppImage: 0.123456,
  });
  const expected = (Math.SQRT2 + Math.hypot(2, 2)) * 0.123456;
  assert.ok(Math.abs(summary.totalLengthM - expected) < 1e-12);
  assert.ok(Math.abs((summary.byRoof[0]?.lengthM ?? 0) - expected) < 1e-12);
});

test("multiple roofs expose a complete per-roof breakdown and project total", () => {
  const summary = summarizeSnowProtection({
    snowGuards: [
      guard("sg-1", "D1", { x: 0, y: 0 }, { x: 52.5, y: 0 }),
      guard("sg-2", "D3", { x: 0, y: 0 }, { x: 81, y: 0 }),
      guard("sg-3", "D4", { x: 0, y: 0 }, { x: 23.5, y: 0 }),
    ],
    mppImage: 0.1,
    roofIds: ["D1", "D2", "D3", "D4"],
  });

  assert.ok(Math.abs(summary.totalLengthM - 15.7) < 1e-12);
  assert.deepEqual(summary.byRoof, [
    { roofId: "D1", lengthM: 5.25 },
    { roofId: "D2", lengthM: 0 },
    { roofId: "D3", lengthM: 8.1 },
    { roofId: "D4", lengthM: 2.35 },
  ]);
});

test("delete and committed geometry edits naturally update the total", () => {
  const initial = [
    guard("keep", "roof-1", { x: 0, y: 0 }, { x: 100, y: 0 }),
    guard("delete", "roof-1", { x: 0, y: 0 }, { x: 35, y: 0 }),
  ];
  assert.equal(summarizeSnowProtection({ snowGuards: initial, mppImage: 0.1 }).totalLengthM, 13.5);

  const afterDelete = initial.filter((segment) => segment.id !== "delete");
  assert.equal(summarizeSnowProtection({ snowGuards: afterDelete, mppImage: 0.1 }).totalLengthM, 10);

  const afterEdit = afterDelete.map((segment) =>
    segment.id === "keep" ? { ...segment, p2: { x: 125, y: 0 } } : segment,
  );
  assert.equal(summarizeSnowProtection({ snowGuards: afterEdit, mppImage: 0.1 }).totalLengthM, 12.5);
});

test("save/reload JSON roundtrip preserves the derived quantity", () => {
  const original = planningDocument({
    guards: [guard("sg-1", "roof-1", { x: 1.25, y: 2.5 }, { x: 91.75, y: 42.25 })],
    roofIds: ["roof-1"],
    mppImage: 0.073,
  });
  const before = deriveSnowProtectionSummaryFromPlanning(original);
  const reloaded = JSON.parse(JSON.stringify(original));
  assert.deepEqual(deriveSnowProtectionSummaryFromPlanning(reloaded), before);
});

test("zoom, pan and viewport rotation cannot affect physical length", () => {
  const geometry = {
    guards: [guard("sg-1", "roof-1", { x: 0, y: 0 }, { x: 30, y: 40 })],
    roofIds: ["roof-1"],
    mppImage: 0.2,
  };
  const variants = [
    { scale: 0.5, offsetX: 0, offsetY: 0, rotationDeg: 0 },
    { scale: 2, offsetX: 900, offsetY: -320, rotationDeg: 90 },
    { scale: 1.25, offsetX: -50, offsetY: 75, rotationDeg: 271 },
  ];
  const totals = variants.map((view) =>
    deriveSnowProtectionSummaryFromPlanning(planningDocument({ ...geometry, view })).totalLengthM,
  );
  assert.deepEqual(totals, [10, 10, 10]);
});

test("legacy plannings load safely and legacy geometry is derived", () => {
  assert.deepEqual(deriveSnowProtectionSummaryFromPlanning({ data: {} }), {
    totalLengthM: 0,
    byRoof: [],
  });

  const legacy = {
    data: {
      layers: [{ id: "legacy-roof" }],
      snowGuards: [
        {
          ...guard("legacy", "legacy-roof", { x: 0, y: 0 }, { x: 50, y: 0 }),
          lengthM: 999,
          pricePerM: 10,
        },
      ],
      mppImage: 0.1,
    },
  };
  assert.deepEqual(deriveSnowProtectionSummaryFromPlanning(legacy), {
    totalLengthM: 5,
    byRoof: [{ roofId: "legacy-roof", lengthM: 5 }],
  });
});

test("API planning resource exposes the CRM contract and replaces stale totals", () => {
  const stored = planningDocument({
    guards: [
      guard("sg-1", "roof-a", { x: 0, y: 0 }, { x: 87, y: 0 }),
      guard("sg-2", "roof-b", { x: 0, y: 0 }, { x: 97, y: 0 }),
    ],
    roofIds: ["roof-a", "roof-b"],
    mppImage: 0.1,
    persistedSummary: {
      snowProtection: { totalLengthM: 999, byRoof: [] },
    },
  });
  const responsePlanning = withSnowProtectionSummary(stored);

  assert.deepEqual(responsePlanning.summary.snowProtection, {
    totalLengthM: 18.4,
    byRoof: [
      { roofId: "roof-a", lengthM: 8.7 },
      { roofId: "roof-b", lengthM: 9.7 },
    ],
  });
});

test("guards whose roof no longer exists do not contribute to the planning summary", () => {
  const summary = summarizeSnowProtection({
    snowGuards: [
      guard("active", "roof-1", { x: 0, y: 0 }, { x: 50, y: 0 }),
      guard("orphan", "deleted-roof", { x: 0, y: 0 }, { x: 70, y: 0 }),
    ],
    mppImage: 0.1,
    roofIds: ["roof-1"],
  });
  assert.deepEqual(summary, {
    totalLengthM: 5,
    byRoof: [{ roofId: "roof-1", lengthM: 5 }],
  });
});
