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
export function buildCommittedMontageFieldMeasurements(input: {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  panels: readonly PanelInstance[];
  mppImage: number;
}): CommittedMontageFieldMeasurement[] {
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
    if (panel.roofId !== input.roof.id || !panel.advanced?.blockKey || !panel.advanced.montageFieldKey) return;
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
      const fieldKey = sourcePanel.advanced?.montageFieldKey;
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
