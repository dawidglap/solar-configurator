import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLatestFrameScheduler } from '../../src/components_v2/canvas/performance/latestFrameScheduler';

const panelsSource = readFileSync(
  new URL('../../src/components_v2/modules/PanelsKonva.tsx', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../src/components_v2/modules/panels/MultiSelectionDragHandle.tsx', import.meta.url),
  'utf8',
);

test('multi-selection renders a hand handle instead of the former plus affordance', () => {
  assert.match(panelsSource, /selectedPanels\.length < 2/);
  assert.match(panelsSource, /if \(!selectedIds\.length\) return \[\]/);
  assert.match(panelsSource, /<MultiSelectionDragHandle/);
  assert.match(handleSource, /HAND_PATHS/);
  assert.match(handleSource, /Auswahl verschieben/);
  assert.match(handleSource, /HANDLE_SIZE_PX = 40/);
  assert.match(handleSource, /--propW/);
  assert.match(handleSource, /--tb/);
  assert.doesNotMatch(handleSource, /points=\{\[\s*-\(6/);
});

test('hand delegates to the existing canonical group-drag lifecycle', () => {
  assert.match(panelsSource, /beginGroupDrag\(e, selectedPanels, e\.currentTarget\)/);
  assert.match(panelsSource, /resolveDirectLayoutTargets\(/);
  assert.match(panelsSource, /createLatestFrameScheduler\(onFrame\)/);
  assert.match(panelsSource, /updatePanelsBulk\(patches\)/);
  assert.equal(
    (panelsSource.match(/updatePanelsBulk\(patches\)/g) ?? []).length,
    1,
    'one group drag has one canonical bulk-commit site',
  );
});

test('raw pointer movement stays frame-coalesced and cannot commit before release', () => {
  const callbacks: FrameRequestCallback[] = [];
  const rendered: number[] = [];
  let commits = 0;
  const scheduler = createLatestFrameScheduler(
    (value: number) => rendered.push(value),
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    () => {},
  );

  for (let index = 0; index < 600; index += 1) scheduler.schedule(index);
  assert.equal(callbacks.length, 1);
  assert.equal(commits, 0);
  scheduler.flush();
  commits += 1;
  assert.deepEqual(rendered, [599]);
  assert.equal(commits, 1);
});

test('handle drag owns pointer cancellation and preserves screen-space presentation', () => {
  assert.match(handleSource, /onPointerDown/);
  assert.match(handleSource, /cursor: 'grab' \| 'grabbing'/);
  assert.match(handleSource, /rotation=\{-canvasRotationDeg\}/);
  assert.match(panelsSource, /lostpointercapture/);
  assert.match(panelsSource, /pointercancel/);
  assert.match(panelsSource, /cancelGroupDrag\(\)/);
  assert.match(panelsSource, /window\.addEventListener\('blur'/);
});
