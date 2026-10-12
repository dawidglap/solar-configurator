import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoofHudPosition } from '../../src/components_v2/canvas/roofHudPosition';

const rectangle = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

test('Normal/Trapez anchors to the selected Referenzkante midpoint, not the roof bbox top', () => {
  const position = resolveRoofHudPosition({
    points: rectangle,
    roofKind: 'flat',
    referenceEdgeIndex: 1,
    scale: 2,
    offsetX: 100,
    offsetY: 100,
    canvasRotationDeg: 0,
    imageSize: { width: 200, height: 100 },
    viewportSize: { width: 600, height: 500 },
  });

  assert.deepEqual(position, { left: 372, top: 160, placement: 'outside' });
});

test('canvas rotation rotates the anchor and outward offset while the DOM badge stays screen-horizontal', () => {
  const position = resolveRoofHudPosition({
    points: rectangle,
    roofKind: 'flat',
    referenceEdgeIndex: 1,
    scale: 1,
    offsetX: 200,
    offsetY: 200,
    canvasRotationDeg: 90,
    imageSize: { width: 200, height: 100 },
    viewportSize: { width: 600, height: 600 },
  });

  assert.ok(position);
  assert.ok(Math.abs(position.left - 320) < 1e-9);
  assert.ok(Math.abs(position.top - 322) < 1e-9);
  assert.equal(position.placement, 'outside');
});

test('an off-screen outside anchor falls back inside near the same reference edge', () => {
  const position = resolveRoofHudPosition({
    points: rectangle,
    roofKind: 'flat',
    referenceEdgeIndex: 0,
    scale: 1,
    offsetX: 100,
    offsetY: 40,
    canvasRotationDeg: 0,
    imageSize: { width: 200, height: 100 },
    viewportSize: { width: 400, height: 300 },
  });

  assert.deepEqual(position, { left: 150, top: 88, placement: 'inside-fallback' });
});
