import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAdvancedBlockLayout,
  createGenericEastWestBlock,
  createGenericSouthBlock,
  deriveTiltedModuleGeometry,
  expandBlockToModules,
  instantiateAdvancedBlock,
  normalizeGeographicAzimuth,
  type AdvancedBlockDefinition,
  type AdvancedModuleSpecification,
} from "../../src/lib/planning-core/advanced";
import {
  isFootprintContainedInUsableRoof,
  polygonArea,
  transformMetricPolygon,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";

const EPSILON = 1e-9;
const PORTRAIT_MODULE: AdvancedModuleSpecification = {
  widthM: 1,
  heightM: 2,
  orientation: "portrait",
};

function close(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function rectangle(widthM: number, heightM: number): MetricPolygon {
  return [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: heightM },
    { x: 0, y: heightM },
  ];
}

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((first, second) => first - second);
}

test("Generic South derives a one-module 1 x 2 m portrait block at 10 degrees", () => {
  const definition = createGenericSouthBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  const slot = definition.moduleSlots[0];

  assert.equal(definition.mountingSystemId, "generic-south");
  assert.equal(definition.planarOrientationDeg, 180);
  assert.equal(definition.moduleSlots.length, 1);
  close(slot.geometry.crossSlopeM, 1, "cross-slope");
  close(slot.geometry.alongSlopeM, 2, "along-slope");
  close(
    slot.geometry.projectedAlongSlopeM,
    2 * Math.cos(Math.PI / 18),
    "projected along-slope",
  );
  close(slot.geometry.riseM, 2 * Math.sin(Math.PI / 18), "rise");
  assert.equal(slot.geometry.nominalTiltDeg, 10);
  assert.equal(slot.geometry.effectiveTiltDeg, 10);
  assert.notStrictEqual(definition.blockFootprint, slot.projectedFootprint);
  assert.deepEqual(definition.blockFootprint, slot.projectedFootprint);
});

test("Landscape swaps the physical cross-slope and along-slope sides", () => {
  const geometry = deriveTiltedModuleGeometry({
    module: { ...PORTRAIT_MODULE, orientation: "landscape" },
    nominalTiltDeg: 10,
  });

  close(geometry.crossSlopeM, 2, "landscape cross-slope");
  close(geometry.alongSlopeM, 1, "landscape along-slope");
  close(
    geometry.projectedAlongSlopeM,
    Math.cos(Math.PI / 18),
    "landscape projection",
  );
  close(geometry.riseM, Math.sin(Math.PI / 18), "landscape rise");
});

test("nominal and effective tilt remain independent for future adapters", () => {
  const geometry = deriveTiltedModuleGeometry({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
    effectiveTiltDeg: 12,
  });

  assert.equal(geometry.nominalTiltDeg, 10);
  assert.equal(geometry.effectiveTiltDeg, 12);
  close(
    geometry.projectedAlongSlopeM,
    2 * Math.cos((12 * Math.PI) / 180),
    "effective-tilt projection",
  );
  close(
    geometry.riseM,
    2 * Math.sin((12 * Math.PI) / 180),
    "effective-tilt rise",
  );
});

test("Generic East-West has exactly two opposing module slots", () => {
  const definition = createGenericEastWestBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
    interModuleGapM: 0.2,
  });
  const projectedModuleDepthM = 2 * Math.cos(Math.PI / 18);
  const expectedBlockDepthM = projectedModuleDepthM * 2 + 0.2;

  assert.equal(definition.mountingSystemId, "generic-east-west");
  assert.equal(definition.planarOrientationDeg, 90);
  assert.equal(definition.moduleSlots.length, 2);
  assert.deepEqual(
    definition.moduleSlots.map((slot) => slot.faceAzimuthOffsetDeg),
    [0, 180],
  );
  close(
    definition.derivedDimensionsM.projectedDepthM,
    expectedBlockDepthM,
    "East-West block depth",
  );
  close(
    polygonArea(definition.blockFootprint),
    expectedBlockDepthM,
    "East-West block footprint area",
  );
  assert.notDeepEqual(
    definition.blockFootprint,
    definition.moduleSlots[0].projectedFootprint,
  );

  const placed = instantiateAdvancedBlock({
    definition,
    centerM: { x: 10, y: 20 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  });
  const modules = expandBlockToModules(placed);
  assert.deepEqual(
    modules.map((module) => module.faceAzimuthDeg),
    [90, 270],
  );
  assert.deepEqual(
    modules.map((module) => module.nominalTiltDeg),
    [10, 10],
  );
  assert.deepEqual(
    modules.map((module) => module.effectiveTiltDeg),
    [10, 10],
  );
});

test("rotating East-West to 100 degrees rotates transforms and preserves tilt", () => {
  const defaultBlock = createGenericEastWestBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  const rotatedBlock = createGenericEastWestBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
    primaryFaceAzimuthDeg: 100,
  });
  const defaultPlaced = instantiateAdvancedBlock({
    definition: defaultBlock,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  });
  const rotatedPlaced = instantiateAdvancedBlock({
    definition: rotatedBlock,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  });
  const defaultModules = expandBlockToModules(defaultPlaced);
  const rotatedModules = expandBlockToModules(rotatedPlaced);

  assert.deepEqual(
    rotatedModules.map((module) => module.faceAzimuthDeg),
    [100, 280],
  );
  assert.equal(
    normalizeGeographicAzimuth(
      rotatedModules[1].faceAzimuthDeg - rotatedModules[0].faceAzimuthDeg,
    ),
    180,
  );
  assert.equal(rotatedPlaced.rotationCartesianDeg, 260);
  assert.notDeepEqual(rotatedPlaced.footprint, defaultPlaced.footprint);
  assert.deepEqual(
    rotatedModules.map((module) => module.nominalTiltDeg),
    defaultModules.map((module) => module.nominalTiltDeg),
  );
  assert.deepEqual(
    rotatedModules.map((module) => module.effectiveTiltDeg),
    defaultModules.map((module) => module.effectiveTiltDeg),
  );
});

test("Generic South grid returns blocks first and one expanded module per block", () => {
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: rectangle(4, 4),
    marginM: 0,
    blockDefinition: createGenericSouthBlock({
      module: PORTRAIT_MODULE,
      nominalTiltDeg: 10,
    }),
  });

  assert.equal(layout.blockCount, 8);
  assert.equal(layout.moduleCount, 8);
  assert.deepEqual(unique(layout.blocks.map((block) => block.columnIndex)), [0, 1, 2, 3]);
  assert.deepEqual(unique(layout.blocks.map((block) => block.rowIndex)), [0, 1]);
  assert.ok(
    layout.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        layout.usableRoof.components,
      ),
    ),
  );
});

test("Generic East-West grid expands every accepted block into two modules", () => {
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: rectangle(8, 4),
    marginM: 0,
    blockDefinition: createGenericEastWestBlock({
      module: PORTRAIT_MODULE,
      nominalTiltDeg: 10,
    }),
  });

  assert.equal(layout.blockCount, 8);
  assert.equal(layout.moduleCount, 16);
  assert.equal(layout.moduleCount, layout.blockCount * 2);
  assert.deepEqual(unique(layout.blocks.map((block) => block.columnIndex)), [0, 1, 2, 3]);
  assert.deepEqual(unique(layout.blocks.map((block) => block.rowIndex)), [0, 1]);
});

test("a reserved corner overlap rejects the entire East-West block", () => {
  const definition = createGenericEastWestBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  const blockDepthM = definition.derivedDimensionsM.projectedDepthM;
  const roof = rectangle(blockDepthM, 1);
  const baseline = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: definition,
  });
  assert.equal(baseline.blockCount, 1);
  assert.ok(
    baseline.modules.every(
      (module) =>
        module.centerM.x < blockDepthM - 0.05 || module.centerM.y < 0.9,
    ),
  );

  const blocked = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: definition,
    reservedZones: [
      {
        polygon: [
          { x: blockDepthM - 0.05, y: 0.9 },
          { x: blockDepthM + 0.05, y: 0.9 },
          { x: blockDepthM + 0.05, y: 1.05 },
          { x: blockDepthM - 0.05, y: 1.05 },
        ],
      },
    ],
  });

  assert.equal(blocked.blockCount, 0);
  assert.equal(blocked.moduleCount, 0);
  assert.equal(blocked.rejected["reserved-zone"], 1);
});

test("proper trapezoid margin contains every accepted rotated South block", () => {
  const trapezoid: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 6.5, y: 5 },
    { x: 1.5, y: 5 },
  ];
  const definition = createGenericSouthBlock({
    module: { widthM: 0.8, heightM: 1, orientation: "portrait" },
    nominalTiltDeg: 10,
    faceAzimuthDeg: 190,
    blockGapX: 0.05,
    blockGapY: 0.05,
  });
  const withoutMargin = computeAdvancedBlockLayout({
    roofPolygonM: trapezoid,
    marginM: 0,
    blockDefinition: definition,
  });
  const withMargin = computeAdvancedBlockLayout({
    roofPolygonM: trapezoid,
    marginM: 0.5,
    blockDefinition: definition,
  });

  assert.ok(withMargin.blockCount > 0);
  assert.ok(withMargin.blockCount < withoutMargin.blockCount);
  assert.ok(withMargin.modules.every((module) => module.faceAzimuthDeg === 190));
  assert.ok(
    withMargin.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        withMargin.usableRoof.components,
      ),
    ),
  );
});

test("snow-guard collision rejects the whole block before module expansion", () => {
  const definition = createGenericSouthBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  const depthM = definition.derivedDimensionsM.projectedDepthM;
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: rectangle(1, depthM),
    marginM: 0,
    blockDefinition: definition,
    snowGuards: [
      {
        start: { x: 0, y: depthM / 2 },
        end: { x: 1, y: depthM / 2 },
        clearanceM: 0,
      },
    ],
  });

  assert.equal(layout.blockCount, 0);
  assert.equal(layout.moduleCount, 0);
  assert.equal(layout.rejected["snow-guard"], 1);
});

test("custom definitions can expand an arbitrary number of deterministic slots", () => {
  const south = createGenericSouthBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  const sourceSlot = south.moduleSlots[0];
  const centers = [-1, 0, 1];
  const customDefinition: AdvancedBlockDefinition = {
    ...south,
    mountingSystemId: "fixture-three-slot-system",
    blockFootprint: rectangle(3, sourceSlot.geometry.projectedAlongSlopeM).map(
      (point) => ({ x: point.x - 1.5, y: point.y - sourceSlot.geometry.projectedAlongSlopeM / 2 }),
    ),
    pitchM: { x: 3, y: sourceSlot.geometry.projectedAlongSlopeM },
    moduleSlots: centers.map((x, slotIndex) => ({
      ...sourceSlot,
      slotIndex,
      localCenterM: { x, y: 0 },
      projectedFootprint: transformMetricPolygon(sourceSlot.projectedFootprint, {
        translationM: { x, y: 0 },
      }),
    })),
  };
  const placed = instantiateAdvancedBlock({
    definition: customDefinition,
    centerM: { x: 5, y: 5 },
    blockIndex: 4,
    columnIndex: 2,
    rowIndex: 1,
  });
  const first = expandBlockToModules(placed);
  const second = expandBlockToModules(placed);

  assert.equal(first.length, 3);
  assert.deepEqual(first.map((module) => module.slotIndex), [0, 1, 2]);
  assert.deepEqual(first, second);
});

test("an Advanced block definition cannot contain zero module slots", () => {
  const definition = createGenericSouthBlock({
    module: PORTRAIT_MODULE,
    nominalTiltDeg: 10,
  });
  assert.throws(
    () =>
      instantiateAdvancedBlock({
        definition: { ...definition, moduleSlots: [] },
        centerM: { x: 0, y: 0 },
        blockIndex: 0,
        columnIndex: 0,
        rowIndex: 0,
      }),
    /at least one module slot/,
  );
});

test("the same Advanced input produces exactly the same ordered output", () => {
  const input = {
    roofPolygonM: rectangle(8, 4),
    marginM: 0.2,
    blockDefinition: createGenericEastWestBlock({
      module: PORTRAIT_MODULE,
      nominalTiltDeg: 10,
      primaryFaceAzimuthDeg: 100,
      interModuleGapM: 0.1,
      blockGapX: 0.05,
      blockGapY: 0.2,
    }),
    phaseX: 0.2,
    phaseY: 0.3,
    anchorX: "center" as const,
    anchorY: "end" as const,
  };

  assert.deepEqual(
    computeAdvancedBlockLayout(input),
    computeAdvancedBlockLayout(input),
  );
});
