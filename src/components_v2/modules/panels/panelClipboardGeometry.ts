import type { PanelInstance } from "@/types/planner";

const PASTE_STEP_M = 0.2;

export type MetricPasteOffset = { xM: number; yM: number };

export type PanelPasteLattice = {
  /** Physical pitch along the copied panel/block local X axis. */
  stepXM: number;
  /** Physical pitch along the copied panel/block local Y axis. */
  stepYM: number;
  /** Current image-space orientation. Viewport rotation is intentionally absent. */
  angleDeg: number;
};

type Point = { x: number; y: number };

function panelCorners(panel: PanelInstance): Point[] {
  const radians = (panel.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -panel.wPx / 2, y: -panel.hPx / 2 },
    { x: panel.wPx / 2, y: -panel.hPx / 2 },
    { x: panel.wPx / 2, y: panel.hPx / 2 },
    { x: -panel.wPx / 2, y: panel.hPx / 2 },
  ].map((point) => ({
    x: panel.cx + point.x * cos - point.y * sin,
    y: panel.cy + point.x * sin + point.y * cos,
  }));
}

function project(point: Point, axis: Point): number {
  return point.x * axis.x + point.y * axis.y;
}

function range(values: readonly number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function validLattice(lattice: PanelPasteLattice): boolean {
  return Number.isFinite(lattice.stepXM) && lattice.stepXM > 0 &&
    Number.isFinite(lattice.stepYM) && lattice.stepYM > 0 &&
    Number.isFinite(lattice.angleDeg);
}

export function resolvePanelPasteLattice(input: {
  panels: readonly PanelInstance[];
  mppImage: number;
  spacingXM: number;
  spacingYM: number;
  advancedPitchM?: { x: number; y: number };
}): PanelPasteLattice | undefined {
  const first = input.panels[0];
  if (!first || !(input.mppImage > 0)) return undefined;
  const lattice = {
    stepXM: input.advancedPitchM?.x ?? first.wPx * input.mppImage + input.spacingXM,
    stepYM: input.advancedPitchM?.y ?? first.hPx * input.mppImage + input.spacingYM,
    angleDeg: first.angleDeg,
  };
  return validLattice(lattice) ? lattice : undefined;
}

/**
 * Finds the valid rigid translation nearest to the preferred visible offset.
 * Candidate positions cover the complete physical panel/block lattice that can
 * intersect the selected roof bounds. This makes deleted generated cells
 * discoverable at any distance without depending on screen pixels or camera
 * rotation.
 */
export function findNearestValidPanelPaste(input: {
  panels: readonly PanelInstance[];
  roofPointsPx: readonly Point[];
  mppImage: number;
  preferredOffset: MetricPasteOffset;
  lattice: PanelPasteLattice;
  isValid: (panels: readonly PanelInstance[]) => boolean;
}): PanelInstance[] | undefined {
  if (
    !input.panels.length ||
    input.roofPointsPx.length < 3 ||
    !(input.mppImage > 0) ||
    !validLattice(input.lattice)
  ) return undefined;

  const preferred = offsetPanelPasteGroup({
    panels: input.panels,
    offset: input.preferredOffset,
    mppImage: input.mppImage,
  });
  if (input.isValid(preferred)) return preferred;

  const radians = (input.lattice.angleDeg * Math.PI) / 180;
  const axisU = { x: Math.cos(radians), y: Math.sin(radians) };
  const axisV = { x: -Math.sin(radians), y: Math.cos(radians) };
  const roofMetric = input.roofPointsPx.map((point) => ({
    x: point.x * input.mppImage,
    y: point.y * input.mppImage,
  }));
  const groupMetric = input.panels.flatMap(panelCorners).map((point) => ({
    x: point.x * input.mppImage,
    y: point.y * input.mppImage,
  }));
  const roofU = range(roofMetric.map((point) => project(point, axisU)));
  const roofV = range(roofMetric.map((point) => project(point, axisV)));
  const groupU = range(groupMetric.map((point) => project(point, axisU)));
  const groupV = range(groupMetric.map((point) => project(point, axisV)));

  const minU = roofU.min - groupU.min;
  const maxU = roofU.max - groupU.max;
  const minV = roofV.min - groupV.min;
  const maxV = roofV.max - groupV.max;
  const preferredU = project(
    { x: input.preferredOffset.xM, y: input.preferredOffset.yM },
    axisU,
  );
  const preferredV = project(
    { x: input.preferredOffset.xM, y: input.preferredOffset.yM },
    axisV,
  );
  const candidateMap = new Map<string, MetricPasteOffset & { distanceSq: number }>();
  // The source-aligned phase finds deleted cells in an existing layout. The
  // preferred-aligned phase covers equally spaced free positions around the
  // visible +200 mm paste target when the copied object was manually placed.
  for (const origin of [{ u: 0, v: 0 }, { u: preferredU, v: preferredV }]) {
    const iMin = Math.ceil((minU - origin.u) / input.lattice.stepXM - 1e-9);
    const iMax = Math.floor((maxU - origin.u) / input.lattice.stepXM + 1e-9);
    const jMin = Math.ceil((minV - origin.v) / input.lattice.stepYM - 1e-9);
    const jMax = Math.floor((maxV - origin.v) / input.lattice.stepYM + 1e-9);
    for (let j = jMin; j <= jMax; j += 1) {
      for (let i = iMin; i <= iMax; i += 1) {
        const localU = origin.u + i * input.lattice.stepXM;
        const localV = origin.v + j * input.lattice.stepYM;
        const offset = {
          xM: axisU.x * localU + axisV.x * localV,
          yM: axisU.y * localU + axisV.y * localV,
        };
        const dx = offset.xM - input.preferredOffset.xM;
        const dy = offset.yM - input.preferredOffset.yM;
        candidateMap.set(
          `${offset.xM.toFixed(9)}:${offset.yM.toFixed(9)}`,
          { ...offset, distanceSq: dx * dx + dy * dy },
        );
      }
    }
  }
  const candidates = [...candidateMap.values()];
  candidates.sort((a, b) =>
    a.distanceSq - b.distanceSq ||
    a.yM - b.yM ||
    a.xM - b.xM,
  );

  for (const candidate of candidates) {
    const offset = { xM: candidate.xM, yM: candidate.yM };
    const translated = offsetPanelPasteGroup({
      panels: input.panels,
      offset,
      mppImage: input.mppImage,
    });
    if (input.isValid(translated)) return translated;
  }
  return undefined;
}

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
      void _montageFieldKey;
      void _thermalFieldKey;
      nextAdvanced = {
        ...semanticAdvanced,
        blockKey,
        layoutRunId: input.layoutRunId,
      };
    }

    const standard = panel.standard;
    const nextStandard = standard
      ? (({ thermalFieldKey: _thermalFieldKey, ...semanticStandard }) => {
          void _thermalFieldKey;
          return semanticStandard;
        })(standard)
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
