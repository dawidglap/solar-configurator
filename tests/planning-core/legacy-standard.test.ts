import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { computeAutoLayoutRects, type AutoRect, type Pt } from "../../src/components_v2/modules/layout";
import { usePlannerV2Store } from "../../src/components_v2/state/plannerV2Store";
import { overlapsReservedRect } from "../../src/components_v2/zones/utils";
import realPlanning from "./fixtures/real-planning-anonymized.json";

const GEOMETRY_EPSILON = 1e-9;

const RECTANGLE: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const STANDARD_INPUT = {
  mppImage: 0.1,
  azimuthDeg: 0,
  orientation: "portrait" as const,
  panelSizeM: { w: 1, h: 2 },
  spacingM: 0.1,
  marginM: 0,
};

type ExpectedRect = Pick<AutoRect, "cx" | "cy" | "wPx" | "hPx" | "angleDeg">;

function close(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= GEOMETRY_EPSILON,
    `${label}: expected ${expected}, received ${actual} (epsilon ${GEOMETRY_EPSILON})`,
  );
}

function sortRects<T extends ExpectedRect>(rects: readonly T[]): T[] {
  return [...rects].sort(
    (a, b) =>
      a.cy - b.cy ||
      a.cx - b.cx ||
      a.angleDeg - b.angleDeg ||
      a.wPx - b.wPx ||
      a.hPx - b.hPx,
  );
}

function assertRects(actualInput: readonly AutoRect[], expectedInput: readonly ExpectedRect[]) {
  const actual = sortRects(actualInput);
  const expected = sortRects(expectedInput);

  assert.equal(actual.length, expected.length, "panel count");
  for (let index = 0; index < expected.length; index += 1) {
    close(actual[index].cx, expected[index].cx, `rect[${index}].cx`);
    close(actual[index].cy, expected[index].cy, `rect[${index}].cy`);
    close(actual[index].wPx, expected[index].wPx, `rect[${index}].wPx`);
    close(actual[index].hPx, expected[index].hPx, `rect[${index}].hPx`);
    close(actual[index].angleDeg, expected[index].angleDeg, `rect[${index}].angleDeg`);
  }
}

function expectedRects(
  centers: ReadonlyArray<readonly [number, number]>,
  { wPx = 10, hPx = 20, angleDeg = 0 } = {},
): ExpectedRect[] {
  return centers.map(([cx, cy]) => ({ cx, cy, wPx, hPx, angleDeg }));
}

function cartesianCenters(xs: readonly number[], ys: readonly number[]) {
  return ys.flatMap((cy) => xs.map((cx) => [cx, cy] as const));
}

function range(count: number, start: number, step: number) {
  return Array.from({ length: count }, (_, index) => start + index * step);
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

function setReservedZone(roofId: string, points: Pt[]) {
  usePlannerV2Store.setState({
    zones: [{ id: "reserved-test", roofId, type: "riservata", points }],
  });
}

afterEach(() => {
  usePlannerV2Store.setState({ zones: [], selectedZoneId: undefined });
});

test("legacy Standard: rectangular roof freezes count, centers, dimensions and angle", () => {
  const actual = computeAutoLayoutRects({ ...STANDARD_INPUT, polygon: RECTANGLE });
  const centers = cartesianCenters(range(9, 5, 11), [10, 31]);

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: a 30 degree rotated rectangle preserves the deterministic grid", () => {
  const origin = { x: 50, y: 30 };
  const polygon = RECTANGLE.map((point) => rotate(point, origin, 30));
  const baseCenters = cartesianCenters(range(9, 5, 11), [10, 31]);
  const centers = baseCenters.map(([x, y]) => {
    const point = rotate({ x, y }, origin, 30);
    return [point.x, point.y] as const;
  });

  const actual = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon,
    azimuthDeg: 30,
  });

  assertRects(actual, expectedRects(centers, { angleDeg: 30 }));
});

test("legacy Standard: trapezoid freezes row-dependent centers", () => {
  const polygon: Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 80, y: 60 },
    { x: 20, y: 60 },
  ];
  const centers = [
    ...range(7, 11 + 2 / 3, 11).map((x) => [x, 10] as const),
    ...range(6, 18 + 2 / 3, 11).map((x) => [x, 31] as const),
  ];

  const actual = computeAutoLayoutRects({ ...STANDARD_INPUT, polygon });

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: concave roof keeps only the longest usable scanline segment", () => {
  const polygon: Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 60, y: 60 },
    { x: 60, y: 30 },
    { x: 40, y: 30 },
    { x: 40, y: 60 },
    { x: 0, y: 60 },
  ];
  const centers = [
    ...range(9, 5, 11).map((x) => [x, 10] as const),
    ...range(3, 5, 11).map((x) => [x, 31] as const),
  ];

  const actual = computeAutoLayoutRects({ ...STANDARD_INPUT, polygon });

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: roof margin keeps the current scanline shrink interpretation", () => {
  const actual = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    marginM: 0.5,
  });
  const centers = cartesianCenters(range(8, 10, 11), [15, 36]);

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: reserved filtering rejects a footprint intersection", () => {
  const roofId = "roof-rectangle";
  setReservedZone(roofId, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);

  const generated = computeAutoLayoutRects({ ...STANDARD_INPUT, polygon: RECTANGLE });
  const actual = generated.filter(
    (rect) =>
      !overlapsReservedRect(
        { cx: rect.cx, cy: rect.cy, w: rect.wPx, h: rect.hPx, angleDeg: rect.angleDeg },
        roofId,
        1,
      ),
  );
  const centers = cartesianCenters(range(9, 5, 11), [10, 31]).filter(
    ([cx, cy]) => cx !== 5 || cy !== 10,
  );

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: portrait maps the short module side to width", () => {
  const actual = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    orientation: "portrait",
  });

  assert.equal(actual.length, 18);
  assert.ok(actual.every((rect) => rect.wPx === 10 && rect.hPx === 20));
});

test("legacy Standard: landscape swaps panel dimensions and freezes its grid", () => {
  const actual = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    orientation: "landscape",
  });
  const centers = cartesianCenters([10, 31, 52, 73], [5, 16, 27, 38, 49]);

  assertRects(actual, expectedRects(centers, { wPx: 20, hPx: 10 }));
});

test("legacy Standard: phaseX and anchorX affect placement while phaseY and anchorY do not", () => {
  const baseline = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    phaseX: 0,
    phaseY: 0,
    anchorX: "start",
    anchorY: "start",
  });
  const anchorXOnly = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    phaseX: 0,
    phaseY: 0,
    anchorX: "center",
    anchorY: "start",
  });
  const xAdjusted = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    phaseX: 0.5,
    phaseY: 0,
    anchorX: "center",
    anchorY: "start",
  });
  const yAdjustedOnly = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    phaseX: 0,
    phaseY: 0.75,
    anchorX: "start",
    anchorY: "end",
  });

  assert.notDeepEqual(sortRects(anchorXOnly), sortRects(baseline));
  assertRects(anchorXOnly, expectedRects(cartesianCenters(range(9, 6, 11), [10, 31])));
  assertRects(
    xAdjusted,
    expectedRects(cartesianCenters(range(8, 11.5, 11), [10, 31])),
  );
  assertRects(yAdjustedOnly, baseline);
});

test("legacy Standard: coverage ratio keeps the first rows from the top", () => {
  const actual = computeAutoLayoutRects({
    ...STANDARD_INPUT,
    polygon: RECTANGLE,
    coverageRatio: 0.5,
  });
  const centers = cartesianCenters(range(9, 5, 11), [10]);

  assertRects(actual, expectedRects(centers));
});

test("legacy Standard: anonymized real planning geometry remains deterministic", () => {
  const roofId = realPlanning.roofId;
  setReservedZone(roofId, realPlanning.reservedZone);

  const layout = realPlanning.layout;
  const generated = computeAutoLayoutRects({
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
  });
  const actual = generated.filter(
    (rect) =>
      !overlapsReservedRect(
        { cx: rect.cx, cy: rect.cy, w: rect.wPx, h: rect.hPx, angleDeg: rect.angleDeg },
        roofId,
        1,
      ),
  );
  const expectedCenters = realPlanning.expected.centers.map(
    ([cx, cy]) => [cx, cy] as const,
  );
  const expected = expectedRects(expectedCenters, {
    wPx: realPlanning.expected.wPx,
    hPx: realPlanning.expected.hPx,
    angleDeg: layout.angleDeg,
  });

  assert.equal(actual.length, realPlanning.expected.count);
  assertRects(actual, expected);
});
