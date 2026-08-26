import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateK2DDomeAllowedRowSpaceRangeMm,
  calculateK2DDomeAssemblyDimension1Mm,
  calculateK2DDomeAssemblyDimension2Mm,
  calculateK2DDomeEffectiveTiltDeg,
  calculateK2DDomeLongSideBlockSizeMm,
  calculateK2DDomeOneBlockRailDepthMm,
  calculateK2DDomeProjectedModuleDepthMm,
  calculateK2DDomeRailDirectionBlockSizeMm,
  calculateK2DDomeServiceCorridorMm,
  computeAdvancedBlockLayout,
  createK2DDomeBlock,
  evaluateK2DDomeBlockLimits,
  expandBlockToModules,
  instantiateAdvancedBlock,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_CONSTANTS_MM,
  K2_D_DOME_SYSTEM_ID,
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

function requireValid(result: ReturnType<typeof createK2DDomeBlock>) {
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

test("D-Dome adapter identity traces drawing 07-481-08 dated 2023-05-05", () => {
  assert.equal(K2_D_DOME_SYSTEM_ID, "k2-d-dome-6.10-classic");
  assert.equal(K2_D_DOME_ADAPTER_VERSION, "07-481-08@2023-05-05");
  assert.deepEqual(K2_D_DOME_CONSTANTS_MM.moduleWidth, {
    min: 950,
    max: 1170,
  });
  assert.deepEqual(K2_D_DOME_CONSTANTS_MM.moduleLength, {
    min: 1448,
    max: 2390,
  });
  assert.deepEqual(K2_D_DOME_CONSTANTS_MM.approximateServiceCorridor, {
    min: 140,
    max: 450,
  });
  assert.equal(K2_D_DOME_CONSTANTS_MM.maxBlockRailDirection, 12_000);
  assert.equal(K2_D_DOME_CONSTANTS_MM.maxBlockLongSide, 16_000);
});

test("950, 1134 and 1170 mm widths derive different tilts and block depths", () => {
  const expected = [
    {
      widthMm: 950,
      lengthMm: 1448,
      rowSpaceMm: 2300,
      tiltDeg: 10.414568518574255,
      projectedMm: 934.3492617321472,
      oneBlockMm: 1946.6985234642943,
    },
    {
      widthMm: 1134,
      lengthMm: 1722,
      rowSpaceMm: 2600,
      tiltDeg: 8.648115980791399,
      projectedMm: 1121.1069362835901,
      oneBlockMm: 2320.2138725671803,
    },
    {
      widthMm: 1170,
      lengthMm: 2390,
      rowSpaceMm: 2700,
      tiltDeg: 8.370590388379998,
      projectedMm: 1157.5362079245874,
      oneBlockMm: 2393.072415849175,
    },
  ];

  for (const fixture of expected) {
    close(
      calculateK2DDomeEffectiveTiltDeg(fixture.widthMm),
      fixture.tiltDeg,
      `${fixture.widthMm} mm tilt`,
    );
    close(
      calculateK2DDomeProjectedModuleDepthMm(fixture.widthMm),
      fixture.projectedMm,
      `${fixture.widthMm} mm projection`,
    );
    close(
      calculateK2DDomeOneBlockRailDepthMm(fixture.widthMm),
      fixture.oneBlockMm,
      `${fixture.widthMm} mm block depth`,
    );
    const adapter = requireValid(
      createK2DDomeBlock({
        module: landscapeModule(
          fixture.widthMm / 1000,
          fixture.lengthMm / 1000,
        ),
        rowSpaceM: fixture.rowSpaceMm / 1000,
      }),
    );
    close(
      adapter.derivedDimensions.oneBlockRailDepthM,
      fixture.oneBlockMm / 1000,
      `${fixture.widthMm} mm adapter block depth`,
    );
  }
  assert.notEqual(expected[0].oneBlockMm, expected[2].oneBlockMm);
});

test("2086-2843 mm is the derived global row-space envelope", () => {
  const lowerWidthRange = calculateK2DDomeAllowedRowSpaceRangeMm(950);
  const upperWidthRange = calculateK2DDomeAllowedRowSpaceRangeMm(1170);

  close(lowerWidthRange.min, 2086.6985234642943, "global lower envelope");
  close(lowerWidthRange.max, 2396.6985234642943, "950 mm upper row space");
  close(upperWidthRange.min, 2533.072415849175, "1170 mm lower row space");
  close(upperWidthRange.max, 2843.072415849175, "global upper envelope");
});

test("representative D-Dome formulas match independent numeric fixtures", () => {
  const moduleWidthMm = 1134;
  const rowSpaceMm = 2600;

  close(
    calculateK2DDomeAssemblyDimension1Mm(moduleWidthMm),
    1005.9617180725287,
    "assembly dimension 1",
  );
  close(
    calculateK2DDomeAssemblyDimension2Mm({ moduleWidthMm, rowSpaceMm }),
    326.78612743281974,
    "assembly dimension 2",
  );
  close(
    calculateK2DDomeServiceCorridorMm({ moduleWidthMm, rowSpaceMm }),
    279.78612743281974,
    "service corridor",
  );
});

test("one row equals two projections plus 78 mm and pitch minus corridor", () => {
  const moduleWidthMm = 1134;
  const rowSpaceMm = 2600;
  const projectedMm = calculateK2DDomeProjectedModuleDepthMm(moduleWidthMm);
  const corridorMm = calculateK2DDomeServiceCorridorMm({
    moduleWidthMm,
    rowSpaceMm,
  });
  const oneBlockMm = calculateK2DDomeOneBlockRailDepthMm(moduleWidthMm);

  close(oneBlockMm, 2 * projectedMm + 78, "two-module physical depth");
  close(oneBlockMm, rowSpaceMm - corridorMm, "pitch minus corridor");
  close(
    calculateK2DDomeRailDirectionBlockSizeMm({
      moduleWidthMm,
      rowSpaceMm,
      quantityRows: 1,
    }),
    oneBlockMm,
    "one-row formula",
  );
  close(
    calculateK2DDomeRailDirectionBlockSizeMm({
      moduleWidthMm,
      rowSpaceMm,
      quantityRows: 3,
    }),
    7520.21387256718,
    "three-row formula",
  );
});

test("long-side formula and max limits preserve datasheet directions", () => {
  close(
    calculateK2DDomeLongSideBlockSizeMm({
      moduleLengthMm: 1722,
      numberOfColumns: 4,
    }),
    7036,
    "four-column long-side size",
  );
  const within = evaluateK2DDomeBlockLimits({
    moduleWidthM: 1.134,
    moduleLengthM: 1.722,
    rowSpaceM: 2.6,
    quantityRows: 3,
    numberOfColumns: 4,
  });
  close(within.railDirectionBlockSizeM, 7.52021387256718, "rail size");
  close(within.longSideBlockSizeM, 7.036, "long-side size");
  assert.deepEqual(within.warnings, []);

  const exceeded = evaluateK2DDomeBlockLimits({
    moduleWidthM: 1.134,
    moduleLengthM: 1.722,
    rowSpaceM: 2.6,
    quantityRows: 5,
    numberOfColumns: 10,
  });
  close(exceeded.railDirectionBlockSizeM, 12.72021387256718, "exceeded rail");
  close(exceeded.longSideBlockSizeM, 17.476, "exceeded long side");
  assert.deepEqual(
    exceeded.warnings.map((warning) => warning.code),
    [
      "rail-direction-block-limit-exceeded",
      "long-side-block-limit-exceeded",
    ],
  );
});

test("D-Dome adapter creates one block with deterministic primary/opposite slots", () => {
  const adapter = requireValid(
    createK2DDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.6,
    }),
  );
  const definition = adapter.definition;
  const blockBounds = polygonBounds(definition.blockFootprint);
  const primaryBounds = polygonBounds(
    definition.moduleSlots[0].projectedFootprint,
  );
  const oppositeBounds = polygonBounds(
    definition.moduleSlots[1].projectedFootprint,
  );

  assert.equal(definition.mountingSystemId, K2_D_DOME_SYSTEM_ID);
  assert.equal(definition.definitionVersion, K2_D_DOME_ADAPTER_VERSION);
  assert.equal(definition.planarOrientationDeg, 90);
  assert.deepEqual(definition.moduleSlots.map((slot) => slot.slotIndex), [0, 1]);
  assert.deepEqual(
    definition.moduleSlots.map((slot) => slot.faceAzimuthOffsetDeg),
    [0, 180],
  );
  close(blockBounds.maxX - blockBounds.minX, 1.816, "system cross-slope");
  close(
    blockBounds.maxY - blockBounds.minY,
    2.3202138725671803,
    "complete pair depth",
  );
  close(primaryBounds.minY - oppositeBounds.maxY, 0.078, "central system gap");
  close(definition.pitchM.x, 1.74, "18 mm long-side spacing");
  close(definition.pitchM.y, 2.6, "row-space pitch");

  const placed = instantiateAdvancedBlock({
    definition,
    centerM: { x: 0, y: 0 },
    blockIndex: 4,
    columnIndex: 2,
    rowIndex: 1,
  });
  const modules = expandBlockToModules(placed);
  assert.equal(modules.length, 2);
  assert.deepEqual(modules.map((module) => module.faceAzimuthDeg), [90, 270]);
  assert.deepEqual(modules.map((module) => module.slotIndex), [0, 1]);
  assert.ok(modules.every((module) => module.blockKey === placed.blockKey));
  assert.ok(modules.every((module) => module.nominalTiltDeg === 10));
  assert.ok(
    modules.every(
      (module) =>
        Math.abs(module.effectiveTiltDeg - 8.648115980791399) <= EPSILON,
    ),
  );
});

test("rotated D-Dome keeps faces opposite and tilt unchanged", () => {
  const defaultAdapter = requireValid(
    createK2DDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.6,
    }),
  );
  const rotatedAdapter = requireValid(
    createK2DDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.6,
      primaryFaceAzimuthDeg: 100,
    }),
  );
  const place = (definition: typeof defaultAdapter.definition) =>
    instantiateAdvancedBlock({
      definition,
      centerM: { x: 0, y: 0 },
      blockIndex: 0,
      columnIndex: 0,
      rowIndex: 0,
    });
  const defaultPlaced = place(defaultAdapter.definition);
  const rotatedPlaced = place(rotatedAdapter.definition);
  const rotatedModules = expandBlockToModules(rotatedPlaced);

  assert.deepEqual(
    rotatedModules.map((module) => module.faceAzimuthDeg),
    [100, 280],
  );
  assert.equal(rotatedPlaced.rotationCartesianDeg, 260);
  assert.notDeepEqual(rotatedPlaced.footprint, defaultPlaced.footprint);
  assert.ok(rotatedModules.every((module) => module.nominalTiltDeg === 10));
  assert.ok(
    rotatedModules.every(
      (module) =>
        Math.abs(module.effectiveTiltDeg - 8.648115980791399) <= EPSILON,
    ),
  );
});

test("dimension, orientation and derived corridor violations are structured", () => {
  const validRowSpaceM = 2.6;
  const fixtures = [
    {
      module: landscapeModule(0.949, 1.722),
      rowSpaceM: validRowSpaceM,
      code: "module-width-below-range",
    },
    {
      module: landscapeModule(1.171, 1.722),
      rowSpaceM: validRowSpaceM,
      code: "module-width-above-range",
    },
    {
      module: landscapeModule(1.134, 1.447),
      rowSpaceM: validRowSpaceM,
      code: "module-length-below-range",
    },
    {
      module: landscapeModule(1.134, 2.391),
      rowSpaceM: validRowSpaceM,
      code: "module-length-above-range",
    },
    {
      module: { ...landscapeModule(1.134, 1.722), orientation: "portrait" as const },
      rowSpaceM: validRowSpaceM,
      code: "unsupported-orientation",
    },
    {
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.4592138725671803,
      code: "service-corridor-below-range",
    },
    {
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.7712138725671803,
      code: "service-corridor-above-range",
    },
    {
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 1,
      code: "derived-geometry-impossible",
    },
  ];

  for (const fixture of fixtures) {
    const result = createK2DDomeBlock({
      module: fixture.module,
      rowSpaceM: fixture.rowSpaceM,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === fixture.code));
    assert.equal(result.definition, null);
  }
});

test("Advanced placement uses D-Dome footprint, pitch and two-module expansion", () => {
  const adapter = requireValid(
    createK2DDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.6,
    }),
  );
  const localCrossSpanM =
    adapter.derivedDimensions.blockFootprintCrossSlopeM +
    2 * adapter.definition.pitchM.x;
  const localRailSpanM =
    adapter.derivedDimensions.oneBlockRailDepthM +
    adapter.definition.pitchM.y;
  const roof = rectangle(localRailSpanM, localCrossSpanM);
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
  });

  assert.equal(layout.blockCount, 6);
  assert.equal(layout.moduleCount, 12);
  assert.equal(layout.moduleCount, layout.blockCount * 2);
  const rowCoordinates = [
    ...new Set(layout.blocks.map((block) => Number(block.centerM.x.toFixed(9)))),
  ].sort((first, second) => first - second);
  assert.equal(rowCoordinates.length, 2);
  close(rowCoordinates[1] - rowCoordinates[0], 2.6, "physical row pitch");
  assert.ok(
    layout.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        layout.usableRoof.components,
      ),
    ),
  );

  const inset = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0.05,
    blockDefinition: adapter.definition,
  });
  assert.ok(inset.blockCount < layout.blockCount);
  assert.ok(
    inset.blocks.every((block) =>
      isFootprintContainedInUsableRoof(
        block.footprint,
        inset.usableRoof.components,
      ),
    ),
  );
});

test("reserved and snow collisions reject the entire two-module pair", () => {
  const adapter = requireValid(
    createK2DDomeBlock({
      module: landscapeModule(1.134, 1.722),
      rowSpaceM: 2.6,
    }),
  );
  const worldWidthM = adapter.derivedDimensions.oneBlockRailDepthM;
  const worldHeightM = adapter.derivedDimensions.blockFootprintCrossSlopeM;
  const roof = rectangle(worldWidthM, worldHeightM);
  const baseline = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
  });
  assert.equal(baseline.blockCount, 1);
  assert.equal(baseline.moduleCount, 2);

  const reserved = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
    reservedZones: [
      {
        polygon: [
          { x: worldWidthM - 0.01, y: worldHeightM - 0.01 },
          { x: worldWidthM + 0.01, y: worldHeightM - 0.01 },
          { x: worldWidthM + 0.01, y: worldHeightM + 0.01 },
          { x: worldWidthM - 0.01, y: worldHeightM + 0.01 },
        ],
      },
    ],
  });
  assert.equal(reserved.blockCount, 0);
  assert.equal(reserved.moduleCount, 0);
  assert.equal(reserved.rejected["reserved-zone"], 1);

  const snow = computeAdvancedBlockLayout({
    roofPolygonM: roof,
    marginM: 0,
    blockDefinition: adapter.definition,
    snowGuards: [
      {
        start: { x: 0, y: worldHeightM / 2 },
        end: { x: worldWidthM, y: worldHeightM / 2 },
        clearanceM: 0,
      },
    ],
  });
  assert.equal(snow.blockCount, 0);
  assert.equal(snow.moduleCount, 0);
  assert.equal(snow.rejected["snow-guard"], 1);
});

test("D-Dome adapter and placement are deterministic", () => {
  const first = createK2DDomeBlock({
    module: landscapeModule(1.134, 1.722),
    rowSpaceM: 2.6,
    primaryFaceAzimuthDeg: 100,
  });
  const second = createK2DDomeBlock({
    module: landscapeModule(1.134, 1.722),
    rowSpaceM: 2.6,
    primaryFaceAzimuthDeg: 100,
  });

  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  const layoutInput = {
    roofPolygonM: rectangle(10, 8),
    marginM: 0.2,
    blockDefinition: first.definition,
    phaseX: 0.2,
    phaseY: 0.3,
    anchorX: "center" as const,
    anchorY: "end" as const,
  };
  assert.deepEqual(
    computeAdvancedBlockLayout(layoutInput),
    computeAdvancedBlockLayout(layoutInput),
  );
});
