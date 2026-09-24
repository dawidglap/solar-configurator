import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { RoofArea } from '../../src/types/planner';

const roof = (id: string): RoofArea => ({
  id,
  name: id,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
});

test('Trapez mode locks roof selection until Normal is restored', async () => {
  const { usePlannerV2Store } = await import(
    '../../src/components_v2/state/plannerV2Store'
  );
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({
    layers: [roof('d1'), roof('d2')],
    selectedId: 'd1',
  });
  usePlannerV2Store.getState().setUI({ roofShapeMode: 'trapezio' });

  usePlannerV2Store.getState().select('d2');
  assert.equal(usePlannerV2Store.getState().selectedId, 'd1');

  usePlannerV2Store.getState().select(undefined);
  assert.equal(usePlannerV2Store.getState().selectedId, 'd1');

  usePlannerV2Store.getState().setUI({ roofShapeMode: 'normal' });
  usePlannerV2Store.getState().select('d2');
  assert.equal(usePlannerV2Store.getState().selectedId, 'd2');

  usePlannerV2Store.getState().resetPlanner();
});

test('removing the active roof safely exits Trapez mode', async () => {
  const { usePlannerV2Store } = await import(
    '../../src/components_v2/state/plannerV2Store'
  );
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [roof('d1')], selectedId: 'd1' });
  usePlannerV2Store.getState().setUI({ roofShapeMode: 'trapezio' });

  usePlannerV2Store.getState().removeRoof('d1');
  assert.equal(usePlannerV2Store.getState().selectedId, undefined);
  assert.equal(usePlannerV2Store.getState().ui.roofShapeMode, 'normal');

  usePlannerV2Store.getState().resetPlanner();
});

test('Trapez handles own the final topmost canvas layer and other hit targets are isolated', () => {
  const canvas = readFileSync('src/components_v2/canvas/CanvasStage.tsx', 'utf8');
  const roofs = readFileSync('src/components_v2/canvas/RoofShapesLayer.tsx', 'utf8');
  const handles = readFileSync('src/components_v2/canvas/RoofHandlesKonva.tsx', 'utf8');
  const sidebar = readFileSync('src/components_v2/panels/ModulesPanel.tsx', 'utf8');

  const annotationsIndex = canvas.indexOf('<RoofAnnotationsLayer');
  const exclusiveLayerIndex = canvas.indexOf('name="roof-trapez-exclusive-layer"');
  assert.ok(annotationsIndex >= 0 && exclusiveLayerIndex > annotationsIndex);
  assert.match(canvas, /listening=\{tool !== "fill-area" && !exclusiveTrapez\}/);
  assert.match(canvas, /listening=\{!drawingCapturesPointer && !exclusiveTrapez\}/);
  assert.match(roofs, /listening=\{!exclusiveTrapez \|\| sel\}/);
  assert.doesNotMatch(roofs, /<RoofHandlesKonva/);
  assert.match(handles, /hitStrokeWidth=\{20\}/);
  assert.match(handles, /e\.evt\.button !== 0/);
  assert.match(sidebar, /inert=\{rowLocked \? true : undefined\}/);
});
