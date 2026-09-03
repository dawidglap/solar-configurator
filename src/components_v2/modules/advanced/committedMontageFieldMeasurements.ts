import {
  imagePointToMetric,
  metricPolygonToImage,
  rotateMetricPoint,
  type ImageMetricAdapter,
} from "@/lib/planning-core/geometry-v2";
import {
  instantiateAdvancedBlock,
  measureMontageFieldBlocks,
  type AdvancedSurfacePlanningV1,
  type PlacedAdvancedBlock,
} from "@/lib/planning-core/advanced";
import type { PanelInstance, Pt, RoofArea } from "@/types/planner";
import { resolveManualAdvancedBlockDefinition } from "../manualPlacement";

export type CommittedMontageFieldMeasurement = {
  fieldKey: string;
  blockCount: number;
  moduleCount: number;
  longSideSizeM: number;
  railSizeM: number;
  outlinePx: Pt[];
};

export type CommittedThermalFieldMeasurement = Omit<CommittedMontageFieldMeasurement, "fieldKey"> & {
  thermalFieldKey: string;
};

function imageAdapter(roof: RoofArea, mppImage: number): ImageMetricAdapter {
  const count = Math.max(1, roof.points.length);
  const center = roof.points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
  return { mppImage, metricOriginPx: center };
}

/**
 * Reconstructs only the committed block envelopes from materialized panels.
 * It never runs placement and therefore cannot move, add or remove modules.
 */
function buildCommittedAdvancedFieldMeasurements(input: {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  panels: readonly PanelInstance[];
  mppImage: number;
}, identity: "montage" | "thermal"): CommittedMontageFieldMeasurement[] {
  if (!(input.mppImage > 0)) return [];
  const definition = resolveManualAdvancedBlockDefinition(input.config);
  if (!definition) return [];
  const adapter = imageAdapter(input.roof, input.mppImage);
  const template = instantiateAdvancedBlock({
    definition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  });
  const panelsByBlock = new Map<string, PanelInstance[]>();
  input.panels.forEach((panel) => {
    const fieldKey = identity === "montage"
      ? panel.advanced?.montageFieldKey
      : panel.advanced?.thermalFieldKey;
    if (panel.roofId !== input.roof.id || !panel.advanced?.blockKey || !fieldKey) return;
    panelsByBlock.set(panel.advanced.blockKey, [
      ...(panelsByBlock.get(panel.advanced.blockKey) ?? []),
      panel,
    ]);
  });

  const fields = new Map<string, { blocks: PlacedAdvancedBlock[]; moduleCount: number }>();
  [...panelsByBlock.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .forEach(([blockKey, blockPanels], blockIndex) => {
      const sourcePanel = [...blockPanels]
        .sort((first, second) => (first.advanced?.slotIndex ?? 0) - (second.advanced?.slotIndex ?? 0))[0];
      const slot = definition.moduleSlots.find(
        (candidate) => candidate.slotIndex === sourcePanel.advanced?.slotIndex,
      );
      const fieldKey = identity === "montage"
        ? sourcePanel.advanced?.montageFieldKey
        : sourcePanel.advanced?.thermalFieldKey;
      if (!slot || !fieldKey) return;
      const moduleCenterM = imagePointToMetric(
        { x: sourcePanel.cx, y: sourcePanel.cy },
        adapter,
      );
      const slotOffsetM = rotateMetricPoint(slot.localCenterM, template.rotationCartesianDeg);
      const blockCenterM = {
        x: moduleCenterM.x - slotOffsetM.x,
        y: moduleCenterM.y - slotOffsetM.y,
      };
      const block = {
        ...instantiateAdvancedBlock({
          definition,
          centerM: blockCenterM,
          blockIndex,
          columnIndex: blockIndex,
          rowIndex: 0,
        }),
        blockKey,
      };
      const current = fields.get(fieldKey) ?? { blocks: [], moduleCount: 0 };
      current.blocks.push(block);
      current.moduleCount += blockPanels.length;
      fields.set(fieldKey, current);
    });

  return [...fields.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([fieldKey, field]) => {
      const measurement = measureMontageFieldBlocks(field.blocks);
      return {
        fieldKey,
        blockCount: field.blocks.length,
        moduleCount: field.moduleCount,
        longSideSizeM: measurement.longSideSizeM,
        railSizeM: measurement.railSizeM,
        outlinePx: metricPolygonToImage(measurement.outline, adapter),
      };
    });
}

export function buildCommittedMontageFieldMeasurements(input: {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  panels: readonly PanelInstance[];
  mppImage: number;
}): CommittedMontageFieldMeasurement[] {
  return buildCommittedAdvancedFieldMeasurements(input, "montage");
}

export function buildCommittedThermalFieldMeasurements(input: {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  panels: readonly PanelInstance[];
  mppImage: number;
}): CommittedThermalFieldMeasurement[] {
  return buildCommittedAdvancedFieldMeasurements(input, "thermal").map((field) => ({
    thermalFieldKey: field.fieldKey,
    blockCount: field.blockCount,
    moduleCount: field.moduleCount,
    longSideSizeM: field.longSideSizeM,
    railSizeM: field.railSizeM,
    outlinePx: field.outlinePx,
  }));
}

/** Measures already-materialized Standard fields; it never regenerates placement. */
export function buildCommittedStandardThermalFieldMeasurements(input: {
  roof: RoofArea;
  panels: readonly PanelInstance[];
  mppImage: number;
}): CommittedThermalFieldMeasurement[] {
  if (!(input.mppImage > 0)) return [];
  const groups = new Map<string, PanelInstance[]>();
  input.panels.forEach((panel) => {
    const fieldKey = panel.standard?.thermalFieldKey;
    if (panel.roofId !== input.roof.id || !fieldKey) return;
    groups.set(fieldKey, [...(groups.get(fieldKey) ?? []), panel]);
  });
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([thermalFieldKey, panels]) => {
      const blocks: PlacedAdvancedBlock[] = panels.map((panel, blockIndex) => {
        const rotationCartesianDeg = -(panel.angleDeg ?? 0);
        const centerM = { x: panel.cx * input.mppImage, y: -panel.cy * input.mppImage };
        const halfWidthM = panel.wPx * input.mppImage / 2;
        const halfHeightM = panel.hPx * input.mppImage / 2;
        const local = [
          { x: -halfWidthM, y: -halfHeightM },
          { x: halfWidthM, y: -halfHeightM },
          { x: halfWidthM, y: halfHeightM },
          { x: -halfWidthM, y: halfHeightM },
        ];
        return {
          engineVersion: "advanced-block-v1",
          blockIndex,
          blockKey: panel.id,
          mountingSystemId: "legacy-standard-thermal-unit",
          definitionVersion: "thermal-fields-v1",
          centerM,
          planarOrientationDeg: panel.angleDeg ?? 0,
          rotationCartesianDeg,
          footprint: local.map((point) => {
            const rotated = rotateMetricPoint(point, rotationCartesianDeg);
            return { x: centerM.x + rotated.x, y: centerM.y + rotated.y };
          }),
          moduleSlots: [],
          derivedDimensionsM: {},
          warnings: [],
          columnIndex: blockIndex,
          rowIndex: 0,
        };
      });
      const measurement = measureMontageFieldBlocks(blocks);
      return {
        thermalFieldKey,
        blockCount: panels.length,
        moduleCount: panels.length,
        longSideSizeM: measurement.longSideSizeM,
        railSizeM: measurement.railSizeM,
        outlinePx: measurement.outline.map((point) => ({
          x: point.x / input.mppImage,
          y: -point.y / input.mppImage,
        })),
      };
    });
}
