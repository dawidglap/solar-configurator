import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateK2SDomeAssemblyDimension1Mm,
  calculateK2SDomeAssemblyDimension2Mm,
  calculateK2SDomeEffectiveTiltDeg,
  calculateK2SDomeLongSideBlockSizeMm,
  calculateK2SDomeRailDirectionBlockSizeMm,
  calculateK2SDomeServiceCorridorMm,
  computeAdvancedBlockLayout,
  createK2SDomeBlock,
  expandBlockToModules,
  instantiateAdvancedBlock,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_SYSTEM_ID,
} from "../../src/lib/planning-core/advanced";
import {
  isFootprintContainedInUsableRoof,
  polygonBounds,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";

const EPSILON = 1e-9;

function close(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function landscapeModule(widthM: number, lengthM: number) {
  return { widthM, heightM: lengthM, orientation: "landscape" as const };
}

function rectangle(widthM: number, heightM: number): MetricPolygon {
  return [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: heightM },
    { x: 0, y: heightM },
  ];
}

function requireValid(result: ReturnType<typeof createK2SDomeBlock>) {
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

test("S-Dome adapter identity traces drawing 07-482-05 dated 2023-05-05", () => {
  assert.equal(K2_S_DOME_SYSTEM_ID, "k2-s-dome-6.10-classic");
  assert.equal(K2_S_DOME_ADAPTER_VERSION, "07-482-05@2023-05-05");
  assert.deepEqual(K2_S_DOME_CONSTANTS_MM.moduleWidth, {
    min: 950,
    max: 1170,
  });
  assert.deepEqual(K2_S_DOME_CONSTANTS_MM.moduleLength, {
    min: 1448,
    max: 2390,
  });
  assert.deepEqual(K2_S_DOME_CONSTANTS_MM.rowSpace, {
    min: 1150,
    max: 2000,
  });
});

test("Fixture A: 950 mm module width reproduces the lower-limit dimensions", () => {
  close(
    calculateK2SDomeEffectiveTiltDeg(950),
    10.414568518574255,
    "950 mm effective tilt",
  );
  close(
    calculateK2SDomeAssemblyDimension1Mm(950),
    819.4082401855304,
    "950 mm assembly dimension 1",
  );
  close(
    calculateK2SDomeAssemblyDimension2Mm({
      moduleWidthMm: 950,
      rowSpaceMm: 1150,
    }),
    200.45073826785284,
    "950 mm assembly dimension 2",
  );
  close(
    calculateK2SDomeServiceCorridorMm({
      moduleWidthMm: 950,
      rowSpaceMm: 1150,
    }),
    215.65073826785283,
    "950 mm service corridor",
  );

  const result = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(0.95, 1.448),
      rowSpaceM: 1.15,
    }),
  );
  close(result.derivedDimensions.effectiveTiltDeg, 10.414568518574255, "tilt");
});

test("Fixture B: representative 1134 x 1722 mm module derives both row spaces", () => {
  const row1500 = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.5,
    }),
  );
  const row1800 = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.8,
    }),
  );

  close(row1500.derivedDimensions.effectiveTiltDeg, 8.648115980791399, "tilt");
  close(
    row1500.derivedDimensions.assemblyDimension1M,
    1.0059617180725287,
    "assembly dimension 1",
  );
  close(
    row1500.derivedDimensions.assemblyDimension2M,
    0.3636930637164099,
    "1500 mm assembly dimension 2",
  );
  close(
    row1500.derivedDimensions.serviceCorridorM,
    0.37889306371640987,
    "1500 mm service corridor",
  );
  close(
    row1800.derivedDimensions.assemblyDimension2M,
    0.6636930637164098,
    "1800 mm assembly dimension 2",
  );
  close(
    row1800.derivedDimensions.serviceCorridorM,
    0.6788930637164099,
    "1800 mm service corridor",
  );
});

test("Fixture C: 1170 mm module width reproduces the upper-limit tilt", () => {
  const result = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.17, 2.39),
      rowSpaceM: 2,
    }),
  );

  close(result.derivedDimensions.effectiveTiltDeg, 8.370590388379998, "tilt");
  close(
    result.derivedDimensions.assemblyDimension1M,
    1.042362320474174,
    "assembly dimension 1",
  );
  close(
    result.derivedDimensions.assemblyDimension2M,
    0.8272637920754125,
    "assembly dimension 2",
  );
  close(
    result.derivedDimensions.serviceCorridorM,
    0.8424637920754126,
    "service corridor",
  );
});

test("official block-size formulas derive rows and columns independently", () => {
  close(
    calculateK2SDomeRailDirectionBlockSizeMm({
      moduleWidthMm: 1134,
      rowSpaceMm: 1500,
      quantityRows: 3,
    }),
    4179.8069362835895,
    "three-row rail-direction block size",
  );
  close(
    calculateK2SDomeLongSideBlockSizeMm({
      moduleLengthMm: 1722,
      numberOfColumns: 4,
    }),
    7036,
    "four-column long-side block size",
  );
});

test("adapter creates separate module and minimum system footprints", () => {
  const result = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.5,
      faceAzimuthDeg: 190,
    }),
  );
  const definition = result.definition;
  const blockBounds = polygonBounds(definition.blockFootprint);
  const moduleBounds = polygonBounds(
    definition.moduleSlots[0].projectedFootprint,
  );

  assert.equal(definition.mountingSystemId, K2_S_DOME_SYSTEM_ID);
  assert.equal(definition.definitionVersion, K2_S_DOME_ADAPTER_VERSION);
  assert.equal(definition.planarOrientationDeg, 190);
  assert.equal(definition.moduleSlots.length, 1);
  close(blockBounds.maxX - blockBounds.minX, 1.816, "system width");
  close(
    blockBounds.maxY - blockBounds.minY,
    1.1798069362835902,
    "system rail depth",
  );
  close(moduleBounds.maxX - moduleBounds.minX, 1.722, "module width in plan");
  close(
    moduleBounds.maxY - moduleBounds.minY,
    1.1211069362835901,
    "module projected depth",
  );
  close(definition.pitchM.x, 1.74, "18 mm column pitch addition");
  close(definition.pitchM.y, 1.5, "row-space pitch");
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    [
      "structural-verification-not-performed",
      "minimum-datasheet-system-envelope",
      "nominal-effective-tilt-differ",
    ],
  );

  const modules = expandBlockToModules(
    instantiateAdvancedBlock({
      definition,
      centerM: { x: 0, y: 0 },
      blockIndex: 0,
      columnIndex: 0,
      rowIndex: 0,
    }),
  );
  assert.equal(modules[0].faceAzimuthDeg, 190);
  assert.equal(modules[0].nominalTiltDeg, 10);
  close(modules[0].effectiveTiltDeg, 8.648115980791399, "effective tilt");
});

test("dimension, row-space and orientation violations return structured errors", () => {
  const fixtures = [
    {
      module: landscapeModule(0.949, 1.722),
      rowSpaceM: 1.5,
      code: "module-width-below-range",
    },
    {
      module: landscapeModule(1.171, 1.722),
      rowSpaceM: 1.5,
      code: "module-width-above-range",
    },
    {
      module: landscapeModule(1.134, 1.447),
      rowSpaceM: 1.5,
      code: "module-length-below-range",
    },
    {
      module: landscapeModule(1.134, 2.391),
      rowSpaceM: 1.5,
      code: "module-length-above-range",
    },
    {
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.149,
      code: "row-space-below-range",
    },
    {
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.001,
      code: "row-space-above-range",
    },
    {
      module: { ...landscapeModule(1.134, 1.722), orientation: "portrait" as const },
      rowSpaceM: 1.5,
      code: "unsupported-orientation",
    },
  ];

  for (const fixture of fixtures) {
    const result = createK2SDomeBlock({
      module: fixture.module,
      rowSpaceM: fixture.rowSpaceM,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === fixture.code));
    assert.equal(result.definition, null);
  }
});

test("individually valid ranges still reject impossible derived geometry", () => {
  const result = createK2SDomeBlock({
    module: landscapeModule(1.17, 1.722),
    rowSpaceM: 1.15,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    "derived-geometry-impossible",
  ]);
});

test("S-Dome placement uses K2 pitches and expands one module per block", () => {
  const adapter = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.5,
    }),
  );
  const widthM =
    adapter.derivedDimensions.blockFootprintCrossSlopeM +
    2 * adapter.definition.pitchM.x;
  const heightM =
    adapter.derivedDimensions.blockFootprintRailDirectionM +
    adapter.definition.pitchM.y;
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: rectangle(widthM, heightM),
    marginM: 0,
    blockDefinition: adapter.definition,
  });

  assert.equal(layout.blockCount, 6);
  assert.equal(layout.moduleCount, 6);
  const rowCoordinates = [
    ...new Set(layout.blocks.map((block) => Number(block.centerM.y.toFixed(9)))),
  ].sort((first, second) => first - second);
  assert.equal(rowCoordinates.length, 2);
  close(rowCoordinates[1] - rowCoordinates[0], 1.5, "row pitch");
  assert.ok(
    layout.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        layout.usableRoof.components,
      ),
    ),
  );

  const insetLayout = computeAdvancedBlockLayout({
    roofPolygonM: rectangle(widthM, heightM),
    marginM: 0.05,
    blockDefinition: adapter.definition,
  });
  assert.ok(insetLayout.blockCount < layout.blockCount);
  assert.ok(
    insetLayout.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        insetLayout.usableRoof.components,
      ),
    ),
  );
});

test("reserved and snow obstacles reject the complete S-Dome system block", () => {
  const adapter = requireValid(
    createK2SDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1.5,
    }),
  );
  const widthM = adapter.derivedDimensions.blockFootprintCrossSlopeM;
  const depthM = adapter.derivedDimensions.blockFootprintRailDirectionM;
  const roof = rectangle(widthM, depthM);
  const baseline = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
  });
  assert.equal(baseline.blockCount, 1);

  const reserved = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
    reservedZones: [
      {
        polygon: [
          { x: widthM - 0.01, y: depthM - 0.01 },
          { x: widthM + 0.01, y: depthM - 0.01 },
          { x: widthM + 0.01, y: depthM + 0.01 },
          { x: widthM - 0.01, y: depthM + 0.01 },
        ],
      },
    ],
  });
  assert.equal(reserved.blockCount, 0);
  assert.equal(reserved.rejected["reserved-zone"], 1);

  const snow = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
    snowGuards: [
      {
        start: { x: 0, y: depthM / 2 },
        end: { x: widthM, y: depthM / 2 },
        clearanceM: 0,
      },
    ],
  });
  assert.equal(snow.blockCount, 0);
  assert.equal(snow.rejected["snow-guard"], 1);
});

test("S-Dome adapter and layout output are deterministic", () => {
  const first = createK2SDomeBlock({
    module: landscapeModule(1.134, 1.722),
    rowSpaceM: 1.8,
    faceAzimuthDeg: 190,
  });
  const second = createK2SDomeBlock({
    module: landscapeModule(1.134, 1.722),
    rowSpaceM: 1.8,
    faceAzimuthDeg: 190,
  });

  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  assert.deepEqual(
    computeAdvancedBlockLayout({
      roofPolygonM: rectangle(8, 6),
      marginM: 0.2,
      blockDefinition: first.definition,
      phaseX: 0.2,
      phaseY: 0.3,
      anchorX: "center",
      anchorY: "end",
    }),
    computeAdvancedBlockLayout({
      roofPolygonM: rectangle(8, 6),
      marginM: 0.2,
      blockDefinition: first.definition,
      phaseX: 0.2,
      phaseY: 0.3,
      anchorX: "center",
      anchorY: "end",
    }),
  );
});
