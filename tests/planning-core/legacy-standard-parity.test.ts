import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  computeAutoLayoutRects,
  type AutoRect,
  type Pt,
} from "../../src/components_v2/modules/layout";
import { usePlannerV2Store } from "../../src/components_v2/state/plannerV2Store";
import {
  overlapsReservedRect,
  overlapsSnowGuard,
} from "../../src/components_v2/zones/utils";
import {
  computeLegacyStandardLayout,
  LEGACY_STANDARD_ENGINE_VERSION,
  type LegacyReservedZone,
  type LegacySnowGuard,
  type LegacyStandardFilterPolicy,
} from "../../src/lib/planning-core/legacy-standard";
import realPlanning from "./fixtures/real-planning-anonymized.json";

const GEOMETRY_EPSILON = 1e-9;

const RECTANGLE: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const BASE_INPUT = {
  polygon: RECTANGLE,
  mppImage: 0.1,
  azimuthDeg: 0,
  orientation: "portrait" as const,
  panelSizeM: { w: 1, h: 2 },
  spacingM: 0.1,
  marginM: 0,
};

type LegacyLayoutArgs = Parameters<typeof computeAutoLayoutRects>[0];

const NO_FILTERS: LegacyStandardFilterPolicy = {
  reservedZones: false,
  snowGuards: false,
};

function sortRects(rects: readonly AutoRect[]) {
  return [...rects].sort(
    (a, b) =>
      a.cy - b.cy ||
      a.cx - b.cx ||
      a.angleDeg - b.angleDeg ||
      a.wPx - b.wPx ||
      a.hPx - b.hPx,
  );
}

function assertClose(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= GEOMETRY_EPSILON,
    `${label}: expected ${expected}, received ${actual} (epsilon ${GEOMETRY_EPSILON})`,
  );
}

function assertRectParity(actualInput: readonly AutoRect[], expectedInput: readonly AutoRect[]) {
  const actual = sortRects(actualInput);
  const expected = sortRects(expectedInput);

  assert.equal(actual.length, expected.length, "panel count parity");
  for (let index = 0; index < expected.length; index += 1) {
    assertClose(actual[index].cx, expected[index].cx, `rect[${index}].cx`);
    assertClose(actual[index].cy, expected[index].cy, `rect[${index}].cy`);
    assertClose(actual[index].wPx, expected[index].wPx, `rect[${index}].wPx`);
    assertClose(actual[index].hPx, expected[index].hPx, `rect[${index}].hPx`);
    assertClose(actual[index].angleDeg, expected[index].angleDeg, `rect[${index}].angleDeg`);
  }
}

function computeCore(
  args: LegacyLayoutArgs,
  options: {
    reservedZones?: LegacyReservedZone[];
    snowGuards?: LegacySnowGuard[];
    filterPolicy?: LegacyStandardFilterPolicy;
  } = {},
) {
  return computeLegacyStandardLayout({
    roofPolygon: args.polygon,
    mppImage: args.mppImage,
    canvasAngleDeg: args.azimuthDeg,
    orientation: args.orientation,
    panelSizeM: {
      widthM: args.panelSizeM.w,
      heightM: args.panelSizeM.h,
    },
    spacingM: args.spacingM,
    marginM: args.marginM,
    phaseX: args.phaseX,
    phaseY: args.phaseY,
    anchorX: args.anchorX,
    anchorY: args.anchorY,
    coverageRatio: args.coverageRatio,
    reservedZones: options.reservedZones ?? [],
    snowGuards: options.snowGuards ?? [],
    filterPolicy: options.filterPolicy ?? NO_FILTERS,
  });
}

function assertUnfilteredParity(args: LegacyLayoutArgs) {
  const legacy = computeAutoLayoutRects(args);
  const core = computeCore(args);

  assert.equal(core.engineVersion, LEGACY_STANDARD_ENGINE_VERSION);
  assert.equal(core.engineVersion, "legacy-v1");
  assert.equal(core.count, legacy.length);
  assert.deepEqual(core.rejected, { reservedZone: 0, snowGuard: 0 });
  assertRectParity(core.candidates, legacy);
  assertRectParity(core.placements, legacy);
}

function rotate(point: Pt, origin: Pt, angleDeg: number): Pt {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

afterEach(() => {
  usePlannerV2Store.setState({ zones: [], snowGuards: [], selectedZoneId: undefined });
});

const syntheticParityCases: Array<{ name: string; input: LegacyLayoutArgs }> = [
  {
    name: "simple rectangle",
    input: BASE_INPUT,
  },
  {
    name: "30 degree rotated rectangle",
    input: {
      ...BASE_INPUT,
      polygon: RECTANGLE.map((point) => rotate(point, { x: 50, y: 30 }, 30)),
      azimuthDeg: 30,
    },
  },
  {
    name: "trapezoid",
    input: {
      ...BASE_INPUT,
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 80, y: 60 },
        { x: 20, y: 60 },
      ],
    },
  },
  {
    name: "concave roof legacy behavior",
    input: {
      ...BASE_INPUT,
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 60, y: 60 },
        { x: 60, y: 30 },
        { x: 40, y: 30 },
        { x: 40, y: 60 },
        { x: 0, y: 60 },
      ],
    },
  },
  {
    name: "legacy roof margin",
    input: { ...BASE_INPUT, marginM: 0.5 },
  },
  {
    name: "portrait orientation",
    input: { ...BASE_INPUT, orientation: "portrait" },
  },
  {
    name: "landscape orientation",
    input: { ...BASE_INPUT, orientation: "landscape" },
  },
  {
    name: "phase and anchor legacy behavior",
    input: {
      ...BASE_INPUT,
      phaseX: 0.5,
      phaseY: 0.75,
      anchorX: "center",
      anchorY: "end",
    },
  },
  {
    name: "coverage ratio",
    input: { ...BASE_INPUT, coverageRatio: 0.5 },
  },
];

for (const parityCase of syntheticParityCases) {
  test(`Planning Core parity: ${parityCase.name}`, () => {
    assertUnfilteredParity(parityCase.input);
  });
}

test("Planning Core parity: reserved-zone fixture matches the current canonical utility", () => {
  const roofId = "roof-reserved-parity";
  const points: Pt[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  usePlannerV2Store.setState({
    zones: [{ id: "reserved", roofId, type: "riservata", points }],
  });

  const legacyCandidates = computeAutoLayoutRects(BASE_INPUT);
  const legacyPlacements = legacyCandidates.filter(
    (candidate) =>
      !overlapsReservedRect(
        {
          cx: candidate.cx,
          cy: candidate.cy,
          w: candidate.wPx,
          h: candidate.hPx,
          angleDeg: candidate.angleDeg,
        },
        roofId,
        1,
      ),
  );
  const core = computeCore(BASE_INPUT, {
    reservedZones: [{ points }],
    filterPolicy: { reservedZones: true, snowGuards: false },
  });

  assertRectParity(core.candidates, legacyCandidates);
  assertRectParity(core.placements, legacyPlacements);
  assert.equal(core.count, 17);
  assert.deepEqual(core.rejected, { reservedZone: 1, snowGuard: 0 });
});

test("Planning Core parity: anonymized real planning fixture", () => {
  const layout = realPlanning.layout;
  const args: LegacyLayoutArgs = {
    polygon: realPlanning.polygon,
    mppImage: realPlanning.mppImage,
    azimuthDeg: layout.angleDeg,
    orientation: layout.orientation as "landscape",
    panelSizeM: { w: layout.panelWidthM, h: layout.panelHeightM },
    spacingM: layout.spacingM,
    marginM: layout.marginM,
    phaseX: layout.phaseX,
    phaseY: layout.phaseY,
    anchorX: layout.anchorX as "start",
    anchorY: layout.anchorY as "start",
    coverageRatio: layout.coverageRatio,
  };
  usePlannerV2Store.setState({
    zones: [
      {
        id: "real-reserved",
        roofId: realPlanning.roofId,
        type: "riservata",
        points: realPlanning.reservedZone,
      },
    ],
  });

  const legacyCandidates = computeAutoLayoutRects(args);
  const legacyPlacements = legacyCandidates.filter(
    (candidate) =>
      !overlapsReservedRect(
        {
          cx: candidate.cx,
          cy: candidate.cy,
          w: candidate.wPx,
          h: candidate.hPx,
          angleDeg: candidate.angleDeg,
        },
        realPlanning.roofId,
        1,
      ),
  );
  const core = computeCore(args, {
    reservedZones: [{ points: realPlanning.reservedZone }],
    filterPolicy: { reservedZones: true, snowGuards: false },
  });

  assertRectParity(core.candidates, legacyCandidates);
  assertRectParity(core.placements, legacyPlacements);
  assert.equal(core.count, realPlanning.expected.count);
});

test("Planning Core filtering policies represent reserved-only and reserved-plus-snow", () => {
  const roofId = "roof-filter-policy";
  const reservedPoints: Pt[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const snowGuard: LegacySnowGuard = {
    p1: { x: 16, y: 0 },
    p2: { x: 16, y: 20 },
  };
  usePlannerV2Store.setState({
    zones: [{ id: "reserved", roofId, type: "riservata", points: reservedPoints }],
    snowGuards: [{ id: "snow", roofId, ...snowGuard }],
  });

  const candidates = computeAutoLayoutRects(BASE_INPUT);
  const legacyReservedOnly = candidates.filter(
    (candidate) =>
      !overlapsReservedRect(
        {
          cx: candidate.cx,
          cy: candidate.cy,
          w: candidate.wPx,
          h: candidate.hPx,
          angleDeg: candidate.angleDeg,
        },
        roofId,
        1,
      ),
  );
  const legacyReservedAndSnow = candidates.filter((candidate) => {
    const reserved = overlapsReservedRect(
      {
        cx: candidate.cx,
        cy: candidate.cy,
        w: candidate.wPx,
        h: candidate.hPx,
        angleDeg: candidate.angleDeg,
      },
      roofId,
      1,
    );
    if (reserved) return false;
    return !overlapsSnowGuard(
      {
        cx: candidate.cx,
        cy: candidate.cy,
        wPx: candidate.wPx,
        hPx: candidate.hPx,
        angleDeg: candidate.angleDeg,
      },
      roofId,
      1,
    );
  });

  const reservedOnly = computeCore(BASE_INPUT, {
    reservedZones: [{ points: reservedPoints }],
    snowGuards: [snowGuard],
    filterPolicy: { reservedZones: true, snowGuards: false },
  });
  const reservedAndSnow = computeCore(BASE_INPUT, {
    reservedZones: [{ points: reservedPoints }],
    snowGuards: [snowGuard],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });

  assertRectParity(reservedOnly.candidates, reservedAndSnow.candidates);
  assertRectParity(reservedOnly.placements, legacyReservedOnly);
  assertRectParity(reservedAndSnow.placements, legacyReservedAndSnow);
  assert.equal(reservedOnly.count, 17);
  assert.deepEqual(reservedOnly.rejected, { reservedZone: 1, snowGuard: 0 });
  assert.equal(reservedAndSnow.count, 16);
  assert.deepEqual(reservedAndSnow.rejected, { reservedZone: 1, snowGuard: 1 });
});
