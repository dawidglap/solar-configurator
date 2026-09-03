import assert from "node:assert/strict";
import test from "node:test";

import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  createK2DDomeBlock,
  createK2SDomeBlock,
  groupK2MontageFields,
  instantiateAdvancedBlock,
  type AdvancedBlockDefinition,
  type PlacedAdvancedBlock,
} from "../../src/lib/planning-core/advanced";
import { rotateMetricPoint } from "../../src/lib/planning-core/geometry-v2";

const moduleSpec = { widthM: 1.134, heightM: 1.722, orientation: "landscape" as const };

function matrix(definition: AdvancedBlockDefinition, columns: number, rows: number): PlacedAdvancedBlock[] {
  const rotation = instantiateAdvancedBlock({
    definition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    rowIndex: 0,
    columnIndex: 0,
  }).rotationCartesianDeg;
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) =>
      instantiateAdvancedBlock({
        definition,
        centerM: rotateMetricPoint({
          x: columnIndex * definition.pitchM.x,
          y: rowIndex * definition.pitchM.y,
        }, rotation),
        blockIndex: rowIndex * columns + columnIndex,
        rowIndex,
        columnIndex,
      }),
    ),
  ).flat();
}

function assertPartition(blocks: readonly PlacedAdvancedBlock[], fields: ReturnType<typeof groupK2MontageFields>["fields"]) {
  const assigned = fields.flatMap((field) => field.blockKeys);
  assert.equal(assigned.length, blocks.length);
  assert.equal(new Set(assigned).size, blocks.length);
  assert.deepEqual([...assigned].sort(), blocks.map((block) => block.blockKey).sort());
}

test("D-Dome large matrix splits deterministically on both verified axes without moving blocks", () => {
  const adapter = createK2DDomeBlock({ module: moduleSpec, rowSpaceM: 2.6, primaryFaceAzimuthDeg: 90 });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const blocks = matrix(adapter.definition, 12, 8);
  const coordinatesBefore = blocks.map((block) => ({ key: block.blockKey, center: block.centerM, footprint: block.footprint }));
  const input = {
    systemId: K2_D_DOME_SYSTEM_ID,
    adapterVersion: K2_D_DOME_ADAPTER_VERSION,
    blocks,
    moduleWidthM: moduleSpec.widthM,
    moduleLengthM: moduleSpec.heightM,
    rowSpaceM: 2.6,
  } as const;
  const first = groupK2MontageFields(input);
  const second = groupK2MontageFields({ ...input, blocks: [...blocks].reverse() });

  assert.deepEqual(second, first);
  assert.ok(first.fields.length > 1);
  assert.ok(first.fields.every((field) => field.railSizeM <= 12 + 1e-9));
  assert.ok(first.fields.every((field) => field.longSideSizeM <= 16 + 1e-9));
  assertPartition(blocks, first.fields);
  assert.deepEqual(
    blocks.map((block) => ({ key: block.blockKey, center: block.centerM, footprint: block.footprint })),
    coordinatesBefore,
  );
  assert.ok(first.fields.every((field) => field.moduleCount === field.blockCount * 2));
});

test("S-Dome large matrix uses its own 12 m / 15 m limits", () => {
  const adapter = createK2SDomeBlock({ module: moduleSpec, rowSpaceM: 1.5, faceAzimuthDeg: 180 });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const blocks = matrix(adapter.definition, 12, 10);
  const result = groupK2MontageFields({
    systemId: K2_S_DOME_SYSTEM_ID,
    adapterVersion: K2_S_DOME_ADAPTER_VERSION,
    blocks,
    moduleWidthM: moduleSpec.widthM,
    moduleLengthM: moduleSpec.heightM,
    rowSpaceM: 1.5,
  });

  assert.ok(result.fields.length > 1);
  assert.ok(result.fields.every((field) => field.railSizeM <= 12 + 1e-9));
  assert.ok(result.fields.every((field) => field.longSideSizeM <= 15 + 1e-9));
  assert.ok(result.fields.every((field) => field.moduleCount === field.blockCount));
  assertPartition(blocks, result.fields);
});

test("fixed 5 x 3 remains one compliant field with unchanged K2 block semantics", () => {
  const dDome = createK2DDomeBlock({ module: moduleSpec, rowSpaceM: 2.6 });
  const sDome = createK2SDomeBlock({ module: moduleSpec, rowSpaceM: 1.5 });
  assert.equal(dDome.valid, true);
  assert.equal(sDome.valid, true);
  if (!dDome.valid || !sDome.valid) return;

  const dBlocks = matrix(dDome.definition, 5, 3);
  const dResult = groupK2MontageFields({
    systemId: K2_D_DOME_SYSTEM_ID,
    adapterVersion: K2_D_DOME_ADAPTER_VERSION,
    blocks: dBlocks,
    moduleWidthM: moduleSpec.widthM,
    moduleLengthM: moduleSpec.heightM,
    rowSpaceM: 2.6,
  });
  assert.equal(dResult.fields.length, 1);
  assert.equal(dResult.fields[0].blockCount, 15);
  assert.equal(dResult.fields[0].moduleCount, 30);

  const sBlocks = matrix(sDome.definition, 5, 3);
  const sResult = groupK2MontageFields({
    systemId: K2_S_DOME_SYSTEM_ID,
    adapterVersion: K2_S_DOME_ADAPTER_VERSION,
    blocks: sBlocks,
    moduleWidthM: moduleSpec.widthM,
    moduleLengthM: moduleSpec.heightM,
    rowSpaceM: 1.5,
  });
  assert.equal(sResult.fields.length, 1);
  assert.equal(sResult.fields[0].blockCount, 15);
  assert.equal(sResult.fields[0].moduleCount, 15);
});

test("a missing grid column splits orthogonally disconnected obstacle islands", () => {
  const adapter = createK2DDomeBlock({ module: moduleSpec, rowSpaceM: 2.6 });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const blocks = matrix(adapter.definition, 5, 2).filter((block) => block.columnIndex !== 2);
  const result = groupK2MontageFields({
    systemId: K2_D_DOME_SYSTEM_ID,
    adapterVersion: K2_D_DOME_ADAPTER_VERSION,
    blocks,
    moduleWidthM: moduleSpec.widthM,
    moduleLengthM: moduleSpec.heightM,
    rowSpaceM: 2.6,
  });

  assert.equal(result.fields.length, 2);
  assert.ok(result.fields.every((field) => field.columnEnd < 2 || field.columnStart > 2));
  assertPartition(blocks, result.fields);
});
