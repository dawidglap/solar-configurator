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

test('Trapez uses one final geometry layer and keeps owner-roof obstacles selectable', () => {
  const canvas = readFileSync('src/components_v2/canvas/CanvasStage.tsx', 'utf8');
  const roofs = readFileSync('src/components_v2/canvas/RoofShapesLayer.tsx', 'utf8');
  const handles = readFileSync('src/components_v2/canvas/RoofHandlesKonva.tsx', 'utf8');
  const movableZone = readFileSync('src/components_v2/zones/MovableZone.tsx', 'utf8');
  const zoneOverlay = readFileSync(
    'src/components_v2/canvas/ZoneTrapezInteractionOverlay.tsx',
    'utf8',
  );
  const sidebar = readFileSync('src/components_v2/panels/ModulesPanel.tsx', 'utf8');

  const annotationsIndex = canvas.indexOf('<RoofAnnotationsLayer');
  const exclusiveLayerIndex = canvas.indexOf('name="geometry-edit-exclusive-layer"');
  assert.ok(annotationsIndex >= 0 && exclusiveLayerIndex > annotationsIndex);
  assert.match(canvas, /listening=\{tool !== "fill-area" && !exclusiveTrapez\}/);
  assert.match(canvas, /<Group listening=\{!drawingCapturesPointer\}>\s*\{layers\.map\(\(l\) => \(\s*<ZonesLayer/);
  assert.match(canvas, /selectedEditableZone \? \(\s*<ZoneTrapezInteractionOverlay/);
  assert.match(canvas, /endManualPlacement\(\);\s*setTool\("select"\);/);
  assert.match(roofs, /listening=\{!exclusiveTrapez \|\| sel\}/);
  assert.doesNotMatch(roofs, /<RoofHandlesKonva/);
  assert.doesNotMatch(movableZone, /<ZoneHandlesKonva/);
  assert.match(zoneOverlay, /plannerHistory\.push\('move reserved zone vertex'\)/);
  assert.match(zoneOverlay, /updateZone\(zone\.id, \{ points, shapeKind: 'polygon' \}\)/);
  assert.match(handles, /hitStrokeWidth=\{20\}/);
  assert.match(handles, /e\.evt\.button !== 0/);
  assert.match(sidebar, /inert=\{rowLocked \? true : undefined\}/);
});

test('roof and obstacle vertex commits are undoable without resetting Trapez geometry', async () => {
  const { usePlannerV2Store } = await import(
    '../../src/components_v2/state/plannerV2Store'
  );
  const { history } = await import('../../src/components_v2/state/history');
  const initialRoof = roof('d1');
  const initialZone = {
    id: 'z1',
    roofId: 'd1',
    type: 'riservata' as const,
    shapeKind: 'rectangle' as const,
    points: [
      { x: 4, y: 4 },
      { x: 10, y: 4 },
      { x: 10, y: 10 },
      { x: 4, y: 10 },
    ],
  };
  const editedRoofPoints = initialRoof.points.map((point, index) =>
    index === 1 ? { x: 18, y: 2 } : point,
  );
  const editedZonePoints = initialZone.points.map((point, index) =>
    index === 2 ? { x: 8, y: 12 } : point,
  );

  usePlannerV2Store.getState().resetPlanner();
  history.clear();
  usePlannerV2Store.setState({
    layers: [initialRoof],
    selectedId: 'd1',
    zones: [initialZone],
    selectedZoneId: 'z1',
  });
  usePlannerV2Store.getState().setUI({ roofShapeMode: 'trapezio' });

  history.push('move roof vertex');
  usePlannerV2Store.getState().updateRoof('d1', { points: editedRoofPoints });
  history.push('move reserved zone vertex');
  usePlannerV2Store.getState().updateZone('z1', {
    points: editedZonePoints,
    shapeKind: 'polygon',
  });
  usePlannerV2Store.getState().setUI({ roofShapeMode: 'normal' });

  assert.deepEqual(usePlannerV2Store.getState().layers[0].points, editedRoofPoints);
  assert.deepEqual(usePlannerV2Store.getState().zones[0].points, editedZonePoints);
  history.undo();
  assert.deepEqual(usePlannerV2Store.getState().zones[0].points, initialZone.points);
  history.redo();
  assert.deepEqual(usePlannerV2Store.getState().zones[0].points, editedZonePoints);

  history.clear();
  usePlannerV2Store.getState().resetPlanner();
});
