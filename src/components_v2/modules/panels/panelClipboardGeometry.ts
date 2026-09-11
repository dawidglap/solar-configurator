import type { PanelInstance } from "@/types/planner";

const PASTE_STEP_M = 0.2;

export type MetricPasteOffset = { xM: number; yM: number };

/**
 * Starts with the visible +200 mm/+200 mm cascade and then checks nearby,
 * deterministic alternatives without depending on viewport zoom or rotation.
 */
export function panelPasteOffsetCandidates(pasteCount: number): MetricPasteOffset[] {
  const startStep = Math.max(1, Math.trunc(pasteCount) + 1);
  const offsets: MetricPasteOffset[] = [];
  for (let step = startStep; step < startStep + 5; step += 1) {
    const distance = step * PASTE_STEP_M;
    offsets.push(
      { xM: distance, yM: distance },
      { xM: -distance, yM: distance },
      { xM: distance, yM: -distance },
      { xM: -distance, yM: -distance },
      { xM: distance, yM: 0 },
      { xM: -distance, yM: 0 },
      { xM: 0, yM: distance },
      { xM: 0, yM: -distance },
    );
  }
  return offsets;
}

export function createPanelPasteGroup(input: {
  source: readonly PanelInstance[];
  roofId: string;
  createPanelId: () => string;
  createBlockKey: () => string;
  layoutRunId: string;
}): PanelInstance[] {
  const blockKeys = new Map<string, string>();
  return input.source.map((panel) => {
    const advanced = panel.advanced;
    let nextAdvanced: PanelInstance["advanced"];
    if (advanced) {
      const sourceBlockKey = advanced.blockKey;
      let blockKey = blockKeys.get(sourceBlockKey);
      if (!blockKey) {
        blockKey = input.createBlockKey();
        blockKeys.set(sourceBlockKey, blockKey);
      }
      const {
        montageFieldKey: _montageFieldKey,
        thermalFieldKey: _thermalFieldKey,
        ...semanticAdvanced
      } = advanced;
      nextAdvanced = {
        ...semanticAdvanced,
        blockKey,
        layoutRunId: input.layoutRunId,
      };
    }

    const standard = panel.standard;
    const nextStandard = standard
      ? (({ thermalFieldKey: _thermalFieldKey, ...semanticStandard }) => semanticStandard)(standard)
      : undefined;

    return {
      ...panel,
      id: input.createPanelId(),
      roofId: input.roofId,
      locked: false,
      ...(nextAdvanced ? { advanced: nextAdvanced } : {}),
      ...(nextStandard ? { standard: nextStandard } : {}),
    };
  });
}

export function offsetPanelPasteGroup(input: {
  panels: readonly PanelInstance[];
  offset: MetricPasteOffset;
  mppImage: number;
}): PanelInstance[] {
  const dx = input.offset.xM / input.mppImage;
  const dy = input.offset.yM / input.mppImage;
  return input.panels.map((panel) => ({
    ...panel,
    cx: panel.cx + dx,
    cy: panel.cy + dy,
  }));
}
