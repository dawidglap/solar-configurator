import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveLocationMarkerPoint,
  shouldShowLocationMarker,
} from "../../src/components_v2/canvas/locationMarkerModel";
import { lonLatTo3857 } from "../../src/components_v2/utils/geo";

const address = { lat: 47.3769, lon: 8.5417 };
const center = lonLatTo3857(address.lon, address.lat);
const snapshot = {
  width: 2800,
  height: 1800,
  bbox3857: {
    minX: center.x - 140,
    minY: center.y - 90,
    maxX: center.x + 140,
    maxY: center.y + 90,
  },
};

test("A-H: marker projects the searched address, independently of Sonnendach roofs", () => {
  assert.deepEqual(resolveLocationMarkerPoint(snapshot, address), { x: 1400, y: 900 });

  const movedAddress = { lat: 47.3771, lon: 8.5419 };
  const moved = resolveLocationMarkerPoint(snapshot, movedAddress);
  assert.ok(moved);
  assert.notDeepEqual(moved, { x: 1400, y: 900 });
});

test("A-D: auto-selection stays visible, explicit selection hides, deselection restores", () => {
  assert.equal(
    shouldShowLocationMarker({ selectedRoofId: "auto-roof", explicitRoofSelectionVersion: 0 }),
    true,
  );
  assert.equal(
    shouldShowLocationMarker({ selectedRoofId: "roof-d1", explicitRoofSelectionVersion: 1 }),
    false,
  );
  assert.equal(
    shouldShowLocationMarker({ selectedRoofId: "roof-d2", explicitRoofSelectionVersion: 2 }),
    false,
  );
  assert.equal(
    shouldShowLocationMarker({ selectedRoofId: undefined, explicitRoofSelectionVersion: 2 }),
    true,
  );
});

test("I: missing or invalid geographic inputs never create an arbitrary marker", () => {
  assert.equal(resolveLocationMarkerPoint({}, address), null);
  assert.equal(resolveLocationMarkerPoint(snapshot, { lat: null, lon: null }), null);
  assert.equal(resolveLocationMarkerPoint(snapshot, { lat: 91, lon: address.lon }), null);
  assert.equal(
    resolveLocationMarkerPoint(
      { width: 2800, height: 1800, bbox3857: { minX: 1, minY: 1, maxX: 1, maxY: 1 } },
      address,
    ),
    null,
  );
});

test("E-G/J/K: canvas integration follows viewport transforms without pointer capture or persistence", () => {
  const marker = readFileSync(
    new URL("../../src/components_v2/canvas/LocationMarkerKonva.tsx", import.meta.url),
    "utf8",
  );
  const model = readFileSync(
    new URL("../../src/components_v2/canvas/locationMarkerModel.ts", import.meta.url),
    "utf8",
  );
  const canvas = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../../src/components_v2/state/plannerV2Store.ts", import.meta.url),
    "utf8",
  );

  assert.match(model, /lonLatToImagePx\(snapshot, address\.lon, address\.lat\)/);
  assert.match(marker, /scaleX=\{inverseScale\}/);
  assert.match(marker, /rotation=\{-canvasRotationDeg\}/);
  assert.match(marker, /listening=\{false\}/);
  assert.match(canvas, /name="location-marker-layer"/);
  assert.match(canvas, /name="viewport-rotated-content"/);
  assert.match(canvas, /findOne\("\.location-marker-layer"\)/);
  assert.match(canvas, /locationMarkerLayer\?\.visible\(false\)/);
  assert.doesNotMatch(store.slice(store.indexOf("partialize:")), /explicitRoofSelectionVersion: s\./);
});
