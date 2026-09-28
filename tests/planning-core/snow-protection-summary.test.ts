import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSnowProtectionSummaryFromPlanning,
  resolveSnowProtectionSummary,
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

test("manual Kalkulation is an explicit override and is never added to geometry", () => {
  const summary = resolveSnowProtectionSummary({
    snowProtection: {
      quantityMode: "manual",
      manualSegments: [
        { id: "manual-1", roofId: "roof-d1", lengthM: 110 },
        { id: "manual-2", roofId: "roof-d1", lengthM: 10 },
      ],
    },
    snowGuards: [
      guard("geometric", "roof-d1", { x: 0, y: 0 }, { x: 50, y: 0 }),
    ],
    mppImage: 0.1,
    roofIds: ["roof-d1"],
  });

  assert.deepEqual(summary, {
    totalLengthM: 120,
    byRoof: [{ roofId: "roof-d1", lengthM: 120 }],
  });
});

test("manual quantity updates and deletion recompute the canonical summary", () => {
  const base = {
    quantityMode: "manual" as const,
    manualSegments: [
      { id: "one", roofId: "roof-d1", lengthM: 110 },
      { id: "two", roofId: "roof-d1", lengthM: 10 },
    ],
  };
  const summarize = (snowProtection: typeof base) =>
    resolveSnowProtectionSummary({
      snowProtection,
      snowGuards: [],
      mppImage: 0.1,
      roofIds: ["roof-d1"],
    });

  assert.equal(summarize(base).totalLengthM, 120);
  assert.equal(summarize({
    ...base,
    manualSegments: base.manualSegments.map((segment) =>
      segment.id === "one" ? { ...segment, lengthM: 90 } : segment,
    ),
  }).totalLengthM, 100);
  assert.equal(summarize({
    ...base,
    manualSegments: base.manualSegments.filter((segment) => segment.id !== "two"),
  }).totalLengthM, 110);
});

test("legacy persisted manual segments infer manual mode", () => {
  const legacy = {
    data: {
      layers: [{ id: "roof-d1" }],
      snowSegments: [
        { id: "legacy-1", lengthM: 110 },
        { id: "legacy-2", lengthM: 10 },
      ],
    },
  };
  assert.deepEqual(deriveSnowProtectionSummaryFromPlanning(legacy), {
    totalLengthM: 120,
    byRoof: [{ roofId: "roof-d1", lengthM: 120 }],
  });
});

test("planner payload and frontend hydration preserve manual Kalkulation without roof selection", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  try {
    const { usePlannerV2Store } = await import(
      "../../src/components_v2/state/plannerV2Store"
    );
    const { buildPlannerPayloadFromStore } = await import(
      "../../src/components_v2/state/planning/savePlanning"
    );
    usePlannerV2Store.getState().resetPlanner();
    usePlannerV2Store.setState({
      layers: [{ id: "roof-d1", name: "D1", points: [] }],
      selectedId: "roof-d1",
      snapshot: { mppImage: 0.1 },
    });
    usePlannerV2Store.getState().setManualSnowProtectionSegments([
      { id: "manual-1", roofId: "roof-d1", lengthM: 110 },
      { id: "manual-2", roofId: "roof-d1", lengthM: 10 },
    ]);

    const patchPayload = JSON.parse(JSON.stringify(buildPlannerPayloadFromStore()));
    assert.deepEqual(patchPayload.snowProtection, {
      quantityMode: "manual",
      manualSegments: [
        { id: "manual-1", roofId: "roof-d1", lengthM: 110 },
        { id: "manual-2", roofId: "roof-d1", lengthM: 10 },
      ],
    });
    assert.equal("pricePerM" in patchPayload.snowProtection, false);

    const getPlanning = withSnowProtectionSummary({
      data: { planner: patchPayload },
      summary: {},
    });
    assert.equal(getPlanning.summary.snowProtection.totalLengthM, 120);

    usePlannerV2Store.getState().resetPlanner();
    usePlannerV2Store.getState().importState(getPlanning.data.planner);
    usePlannerV2Store.setState({
      selectedId: undefined,
      snapshot: getPlanning.data.planner.snapshot,
    });
    const reloaded = usePlannerV2Store.getState();
    const visibleSummary = resolveSnowProtectionSummary({
      snowProtection: reloaded.snowProtection,
      snowGuards: reloaded.snowGuards,
      mppImage: reloaded.snapshot.mppImage,
      roofIds: reloaded.layers.map((roof) => roof.id),
    });
    assert.equal(reloaded.selectedId, undefined);
    assert.equal(visibleSummary.totalLengthM, 120);
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});
