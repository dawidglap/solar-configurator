import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createButtEndedStripPolygon,
  footprintCollidesWithSegmentObstacles,
  polygonArea,
  SNOW_GUARD_WIDTH_M,
} from "../../src/lib/planning-core/geometry-v2";
import {
  snowProtectionSegmentLengthM,
  summarizeSnowProtection,
} from "../../src/lib/planning/snowProtectionSummary";

const EPSILON = 1e-9;

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}

function rectangle(input: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}) {
  return [
    { x: input.minX, y: input.minY },
    { x: input.maxX, y: input.minY },
    { x: input.maxX, y: input.maxY },
    { x: input.minX, y: input.maxY },
  ];
}

test("30 cm butt-ended strip keeps exact physical width at 0, 30, 90 and 137 degrees", () => {
  for (const angleDeg of [0, 30, 90, 137]) {
    const radians = angleDeg * Math.PI / 180;
    const start = { x: 2, y: -3 };
    const end = {
      x: start.x + Math.cos(radians) * 10,
      y: start.y + Math.sin(radians) * 10,
    };
    const strip = createButtEndedStripPolygon({
      start,
      end,
      width: SNOW_GUARD_WIDTH_M,
    });
    assert.equal(strip.length, 4);
    close(Math.hypot(strip[0].x - strip[3].x, strip[0].y - strip[3].y), 0.3);
    close(Math.hypot(strip[0].x - strip[1].x, strip[0].y - strip[1].y), 10);
    close(polygonArea(strip), 3);
  }
});

test("screen width changes with mpp while the represented strip remains 0.30 m", () => {
  for (const mppImage of [0.02, 0.1, 0.5]) {
    const widthPx = SNOW_GUARD_WIDTH_M / mppImage;
    const strip = createButtEndedStripPolygon({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      width: widthPx,
    });
    close(Math.hypot(strip[0].x - strip[3].x, strip[0].y - strip[3].y) * mppImage, 0.3);
  }
});

test("canonical collision uses the rectangular strip with no rounded end or extra margin", () => {
  const snowGuard = [{
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    clearanceM: 0,
    widthM: SNOW_GUARD_WIDTH_M,
  }];

  assert.equal(
    footprintCollidesWithSegmentObstacles(
      rectangle({ minX: 4, maxX: 5, minY: 0.1, maxY: 0.2 }),
      snowGuard,
    ),
    true,
  );
  assert.equal(
    footprintCollidesWithSegmentObstacles(
      rectangle({ minX: 4, maxX: 5, minY: 0.15001, maxY: 0.3 }),
      snowGuard,
    ),
    false,
  );
  assert.equal(
    footprintCollidesWithSegmentObstacles(
      rectangle({ minX: 10.00001, maxX: 10.2, minY: -0.05, maxY: 0.05 }),
      snowGuard,
    ),
    false,
  );
  assert.equal(
    footprintCollidesWithSegmentObstacles(
      rectangle({ minX: 10, maxX: 10.2, minY: -0.05, maxY: 0.05 }),
      snowGuard,
    ),
    true,
  );
});

test("legacy p1/p2 data needs no migration and commercial length stays centerline-only", () => {
  const guard = JSON.parse(JSON.stringify({
    id: "snow-old",
    roofId: "roof-a",
    p1: { x: 10, y: 20 },
    p2: { x: 110, y: 20 },
  }));
  assert.equal(snowProtectionSegmentLengthM(guard, 0.1), 10);
  assert.deepEqual(
    summarizeSnowProtection({ snowGuards: [guard], mppImage: 0.1 }),
    { totalLengthM: 10, byRoof: [{ roofId: "roof-a", lengthM: 10 }] },
  );
  assert.deepEqual(Object.keys(guard).sort(), ["id", "p1", "p2", "roofId"]);
});

test("planner Schneefang interaction is drag-to-commit and both preview and canvas render the strip", () => {
  const drawingHook = readFileSync(
    new URL("../../src/components_v2/canvas/hooks/useDrawingTools.ts", import.meta.url),
    "utf8",
  );
  const preview = readFileSync(
    new URL("../../src/components_v2/canvas/TransientDrawingPreviews.tsx", import.meta.url),
    "utf8",
  );
  const canvas = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(drawingHook, /onStagePointerDown[\s\S]*tool === 'draw-snow-guard'/);
  assert.match(drawingHook, /onStagePointerUp[\s\S]*onSnowGuardCommit\?\.\(start, rawEnd, targetRoofId\)/);
  assert.doesNotMatch(drawingHook, /2 click/);
  assert.match(preview, /createButtEndedStripPolygon/);
  assert.match(canvas, /width: SNOW_GUARD_WIDTH_M \/ snap\.mppImage/);
});

test("top toolbar exposes the canonical Schneefang drawing tool beside the live summary", () => {
  const toolbar = readFileSync(
    new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(toolbar, /actionId="planner-draw-snow-guard"/);
  assert.match(toolbar, /active=\{tool === "draw-snow-guard"\}/);
  assert.match(
    toolbar,
    /tool === "draw-snow-guard" \? "select" : "draw-snow-guard"/,
  );
  assert.match(toolbar, /tooltipLabel="Schneefang zeichnen"/);
  assert.match(toolbar, /tooltipKeys=\{\["Klicken und ziehen"\]\}/);
  assert.match(
    toolbar,
    /totalSnowM\.toFixed\(1\)[\s\S]*totalSnowChf\.toFixed\(2\)/,
  );
});
