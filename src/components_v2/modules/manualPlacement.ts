import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  createGenericEastWestBlock,
  createGenericSouthBlock,
  createK2DDomeBlock,
  createK2SDomeBlock,
  expandBlockToModules,
  groupEffectiveMontageFields,
  groupK2MontageFields,
  groupThermalFields,
  groupRectangularThermalUnits,
  instantiateAdvancedBlock,
  type AdvancedBlockDefinition,
  type AdvancedSurfacePlanningV1,
  type ThermalFieldLimits,
} from "@/lib/planning-core/advanced";
import {
  GEOMETRY_V2_ENGINE_VERSION,
  computeUsableRoof,
  imagePointToMetric,
  imagePolygonToMetric,
  metricPointToImage,
  metricPolygonToImage,
  polygonsIntersectOrTouch,
  rotateMetricPoint,
  validatePlacementFootprint,
  type ImageMetricAdapter,
  type MetricPoint,
  type MetricPolygon,
} from "@/lib/planning-core/geometry-v2";
import type { ModulesConfig, PanelInstance, PanelSpec, Pt, RoofArea } from "@/types/planner";

export type ManualPlacementReason =
  | "outside-usable-roof"
  | "reserved-zone"
  | "snow-guard"
  | "panel-overlap"
  | "unsupported-configuration";

export type ManualPlacementModule = {
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  angleDeg: number;
  footprintPx: Pt[];
  slotIndex: number;
  faceAzimuthDeg?: number;
  nominalTiltDeg?: number;
  effectiveTiltDeg?: number;
};

export type ManualPlacementCandidate = {
  valid: boolean;
  reasons: ManualPlacementReason[];
  blockFootprintPx: Pt[];
  modules: ManualPlacementModule[];
};

type ObstacleZone = { roofId: string; type?: unknown; points: Pt[] };
type SnowGuard = { roofId: string; p1: Pt; p2: Pt };

function imageAdapter(roof: RoofArea, mppImage: number): ImageMetricAdapter {
  const count = Math.max(1, roof.points.length);
  const center = roof.points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
  return { mppImage, metricOriginPx: center };
}

function rectangle(center: Pt, width: number, height: number, angleDeg: number): Pt[] {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => ({
    x: center.x + point.x * cos - point.y * sin,
    y: center.y + point.x * sin + point.y * cos,
  }));
}

function committedPanelFootprints(
  panels: readonly PanelInstance[],
  roofId: string,
  adapter: ImageMetricAdapter,
  excludePanelIds: ReadonlySet<string> = new Set(),
): MetricPolygon[] {
  return panels
    .filter((panel) => panel.roofId === roofId && !excludePanelIds.has(panel.id))
    .map((panel) =>
      imagePolygonToMetric(
        rectangle(
          { x: panel.cx, y: panel.cy },
          panel.wPx,
          panel.hPx,
          panel.angleDeg,
        ),
        adapter,
      ),
    );
}

type PolygonBounds = { minX: number; minY: number; maxX: number; maxY: number };

function polygonBounds(points: readonly MetricPoint[]): PolygonBounds {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function boundsOverlap(a: PolygonBounds, b: PolygonBounds): boolean {
  return !(
    a.maxX < b.minX ||
    b.maxX < a.minX ||
    a.maxY < b.minY ||
    b.maxY < a.minY
  );
}

function cross(origin: MetricPoint, a: MetricPoint, b: MetricPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: readonly MetricPoint[]): MetricPolygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 3) return sorted;
  const lower: MetricPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: MetricPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function atomicPanelFootprints(
  panels: readonly PanelInstance[],
  adapter: ImageMetricAdapter,
): MetricPolygon[] {
  const panelFootprints = panels.map((panel) => imagePolygonToMetric(rectangle(
    { x: panel.cx, y: panel.cy },
    panel.wPx,
    panel.hPx,
    panel.angleDeg,
  ), adapter));
  const advancedBlocks = new Map<string, MetricPoint[]>();
  panels.forEach((panel, index) => {
    const blockKey = panel.advanced?.blockKey;
    if (!blockKey) return;
    advancedBlocks.set(blockKey, [
      ...(advancedBlocks.get(blockKey) ?? []),
      ...panelFootprints[index],
    ]);
  });
  const advancedPanelIndexes = new Set(
    panels.flatMap((panel, index) => panel.advanced?.blockKey ? [index] : []),
  );
  return [
    ...panelFootprints.filter((_footprint, index) => !advancedPanelIndexes.has(index)),
    ...[...advancedBlocks.values()].map(convexHull),
  ];
}

/**
 * Gesture-local hard-boundary validator. The expensive inset roof geometry is
 * prepared once at pointer-down; pointer frames only rebuild the moving
 * footprint(s) and run pure containment checks.
 */
export function createPanelRoofContainmentValidator(input: {
  roof: RoofArea;
  marginM: number;
  mppImage: number;
}): (panels: readonly PanelInstance[]) => boolean {
  const adapter = imageAdapter(input.roof, input.mppImage);
  const usableRoof = computeUsableRoof({
    roofPolygonM: imagePolygonToMetric(input.roof.points, adapter),
    marginM: input.marginM,
  });
  return (panels) => {
    if (!panels.length || panels.some((panel) => panel.roofId !== input.roof.id)) return false;
    return atomicPanelFootprints(panels, adapter).every((footprint) =>
      validatePlacementFootprint({
        footprint,
        usableRoof,
        reservedZones: [],
        snowGuards: [],
      }).valid,
    );
  };
}

/**
 * Faster rigid-drag variant: module/block footprints and usable roof are both
 * immutable for the gesture, so only the proposed translation is evaluated.
 */
export function createPanelRoofTranslationContainmentValidator(input: {
  roof: RoofArea;
  marginM: number;
  mppImage: number;
  panels: readonly PanelInstance[];
}): (dxPx: number, dyPx: number) => boolean {
  if (!input.panels.length || input.panels.some((panel) => panel.roofId !== input.roof.id)) {
    return () => false;
  }
  const adapter = imageAdapter(input.roof, input.mppImage);
  const usableRoof = computeUsableRoof({
    roofPolygonM: imagePolygonToMetric(input.roof.points, adapter),
    marginM: input.marginM,
  });
  const footprints = atomicPanelFootprints(input.panels, adapter);
  return (dxPx, dyPx) => {
    const dxM = dxPx * input.mppImage;
    const dyM = dyPx * input.mppImage;
    return footprints.every((footprint) => validatePlacementFootprint({
      footprint: footprint.map((point) => ({ x: point.x + dxM, y: point.y + dyM })),
      usableRoof,
      reservedZones: [],
      snowGuards: [],
    }).valid);
  };
}

/**
 * Prepares the canonical static placement geometry once. The returned closure
 * reads no store and performs no mutations; callers can use it for generation,
 * paste, drag or any other atomic panel-placement decision.
 */
export function createPanelPlacementValidator(input: {
  roof: RoofArea;
  marginM: number;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
  excludePanelIds?: ReadonlySet<string>;
  moduleGapXM?: number;
  moduleGapYM?: number;
}): (panels: readonly PanelInstance[]) => boolean {
  const adapter = imageAdapter(input.roof, input.mppImage);
  const usableRoof = computeUsableRoof({
    roofPolygonM: imagePolygonToMetric(input.roof.points, adapter),
    marginM: input.marginM,
  });
  const reservedZones = input.zones
    .filter((zone) => zone.roofId === input.roof.id && zone.type !== "walkway")
    .map((zone, index) => ({
      id: `zone-${index}`,
      polygon: imagePolygonToMetric(zone.points, adapter),
    }));
  const snowGuards = input.snowGuards
    .filter((guard) => guard.roofId === input.roof.id)
    .map((guard, index) => ({
      id: `snow-${index}`,
      start: imagePointToMetric(guard.p1, adapter),
      end: imagePointToMetric(guard.p2, adapter),
      clearanceM: 0,
    }));
  const occupied = input.panels
    .filter((panel) => panel.roofId === input.roof.id && !input.excludePanelIds?.has(panel.id))
    .map((panel) => {
      const polygon = imagePolygonToMetric(rectangle(
        { x: panel.cx, y: panel.cy },
        panel.wPx,
        panel.hPx,
        panel.angleDeg,
      ), adapter);
      return { panel, polygon, bounds: polygonBounds(polygon) };
    });
  const gapXM = Math.max(0, input.moduleGapXM ?? 0);
  const gapYM = Math.max(0, input.moduleGapYM ?? 0);
  const spacingEpsilonM = 1e-6;

  return (panels) => {
    if (!panels.length || panels.some((panel) => panel.roofId !== input.roof.id)) return false;
    const atomicFootprints = atomicPanelFootprints(panels, adapter);

    const geometryValid = atomicFootprints.every((footprint) => {
      const geometric = validatePlacementFootprint({
        footprint,
        usableRoof,
        reservedZones,
        snowGuards,
      });
      if (!geometric.valid) return false;
      const bounds = polygonBounds(footprint);
      return !occupied.some((candidate) =>
        boundsOverlap(bounds, candidate.bounds) &&
        polygonsIntersectOrTouch(footprint, candidate.polygon),
      );
    });
    if (!geometryValid) return false;

    // Generic/Schrägdach spacing is physical geometry, not a magnetic halo.
    // Advanced units keep their adapter-defined block pitch and are therefore
    // validated only through their exact atomic footprint above.
    return panels.every((panel) => {
      if (panel.advanced?.blockKey) return true;
      const angleRad = panel.angleDeg * Math.PI / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      return !occupied.some(({ panel: other }) => {
        if (other.advanced?.blockKey) return false;
        const difference = Math.abs(
          ((((other.angleDeg - panel.angleDeg + 180) % 360) + 360) % 360) - 180,
        );
        if (Math.min(difference, Math.abs(180 - difference)) > 0.25) return false;
        const dxM = (other.cx - panel.cx) * input.mppImage;
        const dyM = (other.cy - panel.cy) * input.mppImage;
        const duM = Math.abs(dxM * cos + dyM * sin);
        const dvM = Math.abs(-dxM * sin + dyM * cos);
        const minU = (panel.wPx + other.wPx) * input.mppImage / 2 + gapXM;
        const minV = (panel.hPx + other.hPx) * input.mppImage / 2 + gapYM;
        return duM < minU - spacingEpsilonM && dvM < minV - spacingEpsilonM;
      });
    });
  };
}

/** Backward-compatible name for clipboard callers. */
export const createPanelPastePlacementValidator = createPanelPlacementValidator;

function validate(input: {
  footprintM: MetricPolygon;
  roof: RoofArea;
  marginM: number;
  adapter: ImageMetricAdapter;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
  excludePanelIds?: ReadonlySet<string>;
}): { valid: boolean; reasons: ManualPlacementReason[] } {
  const usableRoof = computeUsableRoof({
    roofPolygonM: imagePolygonToMetric(input.roof.points, input.adapter),
    marginM: input.marginM,
  });
  const geometric = validatePlacementFootprint({
    footprint: input.footprintM,
    usableRoof,
    reservedZones: input.zones
      .filter((zone) => zone.roofId === input.roof.id && zone.type !== "walkway")
      .map((zone, index) => ({
        id: `zone-${index}`,
        polygon: imagePolygonToMetric(zone.points, input.adapter),
      })),
    snowGuards: input.snowGuards
      .filter((guard) => guard.roofId === input.roof.id)
      .map((guard, index) => ({
        id: `snow-${index}`,
        start: imagePointToMetric(guard.p1, input.adapter),
        end: imagePointToMetric(guard.p2, input.adapter),
        clearanceM: 0,
      })),
  });
  const reasons: ManualPlacementReason[] = [...geometric.reasons];
  if (
    committedPanelFootprints(input.panels, input.roof.id, input.adapter, input.excludePanelIds).some(
      (panelFootprint) => polygonsIntersectOrTouch(input.footprintM, panelFootprint),
    )
  ) {
    reasons.push("panel-overlap");
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateExistingPanelPlacement(input: {
  panel: PanelInstance;
  centerPx: Pt;
  angleDeg?: number;
  roof: RoofArea;
  marginM: number;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
  excludePanelIds?: ReadonlySet<string>;
}): { valid: boolean; reasons: ManualPlacementReason[] } {
  const adapter = imageAdapter(input.roof, input.mppImage);
  return validate({
    footprintM: imagePolygonToMetric(rectangle(
      input.centerPx,
      input.panel.wPx,
      input.panel.hPx,
      input.angleDeg ?? input.panel.angleDeg,
    ), adapter),
    roof: input.roof,
    marginM: input.marginM,
    adapter,
    zones: input.zones,
    snowGuards: input.snowGuards,
    panels: input.panels,
    excludePanelIds: input.excludePanelIds ?? new Set([input.panel.id]),
  });
}

export function buildStandardManualCandidate(input: {
  centerPx: Pt;
  roof: RoofArea;
  panel: PanelSpec;
  orientation: "portrait" | "landscape";
  angleDeg: number;
  marginM: number;
  gapXM?: number;
  gapYM?: number;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
}): ManualPlacementCandidate {
  const widthM = input.orientation === "portrait" ? input.panel.widthM : input.panel.heightM;
  const heightM = input.orientation === "portrait" ? input.panel.heightM : input.panel.widthM;
  const wPx = widthM / input.mppImage;
  const hPx = heightM / input.mppImage;
  const footprintPx = rectangle(input.centerPx, wPx, hPx, input.angleDeg);
  const adapter = imageAdapter(input.roof, input.mppImage);
  const footprintM = imagePolygonToMetric(footprintPx, adapter);
  const validation = validate({ ...input, adapter, footprintM });
  const radians = (input.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const tooClose = input.panels.some((panel) => {
    if (panel.roofId !== input.roof.id) return false;
    const angleDifference = Math.abs(
      ((((panel.angleDeg - input.angleDeg + 180) % 360) + 360) % 360) - 180,
    );
    if (Math.min(angleDifference, Math.abs(180 - angleDifference)) > 5) return false;
    const dx = panel.cx - input.centerPx.x;
    const dy = panel.cy - input.centerPx.y;
    const du = Math.abs(dx * cos + dy * sin);
    const dv = Math.abs(-dx * sin + dy * cos);
    return (
      du < (wPx + panel.wPx) / 2 + (input.gapXM ?? 0) / input.mppImage - 1e-6 &&
      dv < (hPx + panel.hPx) / 2 + (input.gapYM ?? 0) / input.mppImage - 1e-6
    );
  });
  if (tooClose && !validation.reasons.includes("panel-overlap")) {
    validation.reasons.push("panel-overlap");
    validation.valid = false;
  }
  return {
    ...validation,
    blockFootprintPx: footprintPx,
    modules: [{
      cx: input.centerPx.x,
      cy: input.centerPx.y,
      wPx,
      hPx,
      angleDeg: input.angleDeg,
      footprintPx,
      slotIndex: 0,
    }],
  };
}

export function snapStandardManualCenter(input: {
  pointerPx: Pt;
  roofId: string;
  panels: readonly PanelInstance[];
  angleDeg: number;
  widthPx: number;
  heightPx: number;
  gapXPx: number;
  gapYPx: number;
  activationThresholdPx?: number;
  disableSnap: boolean;
}): Pt {
  if (input.disableSnap) return input.pointerPx;
  const radians = (input.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toLocal = (point: Pt): Pt => ({
    x: point.x * cos + point.y * sin,
    y: -point.x * sin + point.y * cos,
  });
  const toWorld = (point: Pt): Pt => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  });
  const pointer = toLocal(input.pointerPx);
  const activationThresholdPx = Math.max(0, input.activationThresholdPx ?? 10);
  let best = pointer;
  let snapped = false;
  let bestDistance = activationThresholdPx + Number.EPSILON;
  for (const panel of input.panels) {
    if (panel.roofId !== input.roofId) continue;
    const angleDifference = Math.abs((((panel.angleDeg - input.angleDeg + 180) % 360) + 360) % 360 - 180);
    if (Math.min(angleDifference, Math.abs(180 - angleDifference)) > 5) continue;
    const center = toLocal({ x: panel.cx, y: panel.cy });
    const horizontalOffset = (input.widthPx + panel.wPx) / 2 + input.gapXPx;
    const verticalOffset = (input.heightPx + panel.hPx) / 2 + input.gapYPx;
    const targets = [
      { x: center.x - horizontalOffset, y: center.y },
      { x: center.x + horizontalOffset, y: center.y },
      { x: center.x, y: center.y - verticalOffset },
      { x: center.x, y: center.y + verticalOffset },
    ];
    targets.forEach((target) => {
      const distance = Math.hypot(pointer.x - target.x, pointer.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = target;
        snapped = true;
      }
    });
  }
  return snapped ? toWorld(best) : input.pointerPx;
}

export function resolveManualAdvancedBlockDefinition(
  config: AdvancedSurfacePlanningV1,
): AdvancedBlockDefinition | null {
  const system = config.advanced.system;
  const moduleSpec = config.advanced.module;
  if (system.systemId === K2_D_DOME_SYSTEM_ID) {
    const result = createK2DDomeBlock({
      module: moduleSpec,
      rowSpaceM: system.rowSpaceM,
      primaryFaceAzimuthDeg: system.primaryFaceAzimuthDeg,
    });
    return result.valid ? result.definition : null;
  }
  if (system.systemId === K2_S_DOME_SYSTEM_ID) {
    const result = createK2SDomeBlock({
      module: moduleSpec,
      rowSpaceM: system.rowSpaceM,
      faceAzimuthDeg: system.faceAzimuthDeg,
    });
    return result.valid ? result.definition : null;
  }
  if (system.systemId === GENERIC_SOUTH_SYSTEM_ID) {
    return createGenericSouthBlock({
      module: moduleSpec,
      nominalTiltDeg: system.nominalTiltDeg,
      faceAzimuthDeg: system.faceAzimuthDeg,
      moduleGapX: system.moduleGapX,
      moduleGapY: system.moduleGapY,
      blockGapX: system.blockGapX,
      blockGapY: system.blockGapY,
    });
  }
  if (system.systemId === GENERIC_EAST_WEST_SYSTEM_ID) {
    return createGenericEastWestBlock({
      module: moduleSpec,
      nominalTiltDeg: system.nominalTiltDeg,
      primaryFaceAzimuthDeg: system.primaryFaceAzimuthDeg,
      interModuleGapM: system.interModuleGapM,
      moduleGapX: system.moduleGapX,
      blockGapX: system.blockGapX,
      blockGapY: system.blockGapY,
    });
  }
  return null;
}

export type AdvancedManualSnapResolution = {
  position: Pt;
  snapped: boolean;
  snapKey: string | null;
  guides: AdvancedManualSnapGuide[];
};

export type AdvancedManualSnapGuide = {
  axis: "row" | "column";
  points: [Pt, Pt];
};

export type AdvancedManualSnapCenter = Pt & { blockKey: string };

export function buildAdvancedManualSnapCenters(input: {
  roofId: string;
  panels: readonly PanelInstance[];
}): AdvancedManualSnapCenter[] {
  const byBlock = new Map<string, PanelInstance[]>();
  input.panels.forEach((panel) => {
    if (panel.roofId !== input.roofId || !panel.advanced?.blockKey) return;
    const key = panel.advanced.blockKey;
    byBlock.set(key, [...(byBlock.get(key) ?? []), panel]);
  });
  return [...byBlock.entries()].map(([blockKey, items]) => ({
    blockKey,
    x: items.reduce((sum, panel) => sum + panel.cx, 0) / items.length,
    y: items.reduce((sum, panel) => sum + panel.cy, 0) / items.length,
  }));
}

export function resolveAdvancedManualCenterSnap(input: {
  pointerPx: Pt;
  roofId: string;
  panels: readonly PanelInstance[];
  centers?: readonly AdvancedManualSnapCenter[];
  definition: AdvancedBlockDefinition;
  mppImage: number;
  activationThresholdPx?: number;
  releaseThresholdPx?: number;
  activeSnapKey?: string | null;
  validateCandidate?: (center: Pt) => boolean;
  disableSnap: boolean;
}): AdvancedManualSnapResolution {
  if (input.disableSnap) return { position: input.pointerPx, snapped: false, snapKey: null, guides: [] };
  const centers = input.centers ?? buildAdvancedManualSnapCenters(input);
  if (!centers.length) return { position: input.pointerPx, snapped: false, snapKey: null, guides: [] };
  const rotation = ((90 - input.definition.planarOrientationDeg) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const activation = Math.max(0, input.activationThresholdPx ?? 10);
  const release = Math.max(activation, input.releaseThresholdPx ?? activation * 1.5);
  const localU = { x: cos, y: -sin };
  const localV = { x: -sin, y: -cos };
  const project = (point: Pt) => ({
    u: point.x * localU.x + point.y * localU.y,
    v: point.x * localV.x + point.y * localV.y,
  });
  const fromLocal = (u: number, v: number): Pt => ({
    x: u * localU.x + v * localV.x,
    y: u * localU.y + v * localV.y,
  });
  type Candidate = {
    key: string;
    position: Pt;
    distance: number;
    axes: ("row" | "column")[];
  };
  const candidates: Candidate[] = [];
  for (const origin of centers) {
    const targets = [
      { side: 'left', x: -input.definition.pitchM.x, y: 0 },
      { side: 'right', x: input.definition.pitchM.x, y: 0 },
      { side: 'top', x: 0, y: -input.definition.pitchM.y },
      { side: 'bottom', x: 0, y: input.definition.pitchM.y },
    ];
    for (const target of targets) {
      const worldX = target.x * cos - target.y * sin;
      const worldY = target.x * sin + target.y * cos;
      const candidate = {
        x: origin.x + worldX / input.mppImage,
        y: origin.y - worldY / input.mppImage,
      };
      const distance = Math.hypot(candidate.x - input.pointerPx.x, candidate.y - input.pointerPx.y);
      const key = `advanced-adjacency:${origin.blockKey}:${target.side}`;
      const threshold = key === input.activeSnapKey ? release : activation;
      if (distance <= threshold && (input.validateCandidate?.(candidate) ?? true)) {
        candidates.push({
          key,
          position: candidate,
          distance,
          axes: [target.side === 'left' || target.side === 'right' ? 'row' : 'column'],
        });
      }
    }
  }
  const candidateGroups: Candidate[][] = [];
  candidates.forEach((candidate) => {
    const group = candidateGroups.find((current) => (
      Math.hypot(
        current[0].position.x - candidate.position.x,
        current[0].position.y - candidate.position.y,
      ) <= 1e-5
    ));
    if (group) group.push(candidate);
    else candidateGroups.push([candidate]);
  });
  const exactGridCandidates = candidateGroups.flatMap((group): Candidate[] => {
    const axes = [...new Set(group.flatMap((candidate) => candidate.axes))];
    if (axes.length < 2) return [];
    return [{
      key: `advanced-grid-cell:${group.map((candidate) => candidate.key).sort().join('|')}`,
      position: { ...group[0].position },
      distance: group[0].distance,
      axes,
    }];
  });
  const ranked = [...exactGridCandidates, ...candidates];
  ranked.sort((first, second) => (
    second.axes.length - first.axes.length || first.distance - second.distance || first.key.localeCompare(second.key)
  ));
  const active = input.activeSnapKey
    ? ranked.find((candidate) => candidate.key === input.activeSnapKey)
    : undefined;
  const best = ranked[0];
  const switchMargin = Math.max(1, activation * 0.25);
  const bestMateriallyBetter = Boolean(active && best && (
    best.axes.length > active.axes.length || (
      best.axes.length === active.axes.length && best.distance + switchMargin < active.distance
    )
  ));
  const chosen = active && !bestMateriallyBetter ? active : best;
  const guides = chosen ? chosen.axes.map((axis): AdvancedManualSnapGuide => {
    const candidateLocal = project(chosen.position);
    const pitchPx = (axis === 'row' ? input.definition.pitchM.x : input.definition.pitchM.y) /
      Math.max(input.mppImage, 1e-9);
    if (axis === 'row') {
      const aligned = centers.map((center) => project(center)).filter((center) => (
        Math.abs(center.v - candidateLocal.v) <= 1e-4
      ));
      const start = Math.min(candidateLocal.u, ...aligned.map((center) => center.u)) - pitchPx / 2;
      const end = Math.max(candidateLocal.u, ...aligned.map((center) => center.u)) + pitchPx / 2;
      return { axis, points: [fromLocal(start, candidateLocal.v), fromLocal(end, candidateLocal.v)] };
    }
    const aligned = centers.map((center) => project(center)).filter((center) => (
      Math.abs(center.u - candidateLocal.u) <= 1e-4
    ));
    const start = Math.min(candidateLocal.v, ...aligned.map((center) => center.v)) - pitchPx / 2;
    const end = Math.max(candidateLocal.v, ...aligned.map((center) => center.v)) + pitchPx / 2;
    return { axis, points: [fromLocal(candidateLocal.u, start), fromLocal(candidateLocal.u, end)] };
  }) : [];
  return chosen
    ? { position: chosen.position, snapped: true, snapKey: chosen.key, guides }
    : { position: input.pointerPx, snapped: false, snapKey: null, guides: [] };
}

export function snapAdvancedManualCenter(input: {
  pointerPx: Pt;
  roofId: string;
  panels: readonly PanelInstance[];
  definition: AdvancedBlockDefinition;
  mppImage: number;
  activationThresholdPx?: number;
  disableSnap: boolean;
}): Pt {
  return resolveAdvancedManualCenterSnap(input).position;
}

export function buildAdvancedManualCandidate(input: {
  centerPx: Pt;
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
}): ManualPlacementCandidate {
  const definition = resolveManualAdvancedBlockDefinition(input.config);
  if (!definition) {
    return { valid: false, reasons: ["unsupported-configuration"], blockFootprintPx: [], modules: [] };
  }
  const adapter = imageAdapter(input.roof, input.mppImage);
  const block = instantiateAdvancedBlock({
    definition,
    centerM: imagePointToMetric(input.centerPx, adapter),
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  });
  const validation = validate({
    ...input,
    adapter,
    marginM: input.config.advanced.layout.marginM,
    footprintM: block.footprint,
  });
  const modules = expandBlockToModules(block).map((module) => ({
    ...metricPointToImage(module.centerM, adapter),
    cx: metricPointToImage(module.centerM, adapter).x,
    cy: metricPointToImage(module.centerM, adapter).y,
    wPx: module.crossSlopeM / input.mppImage,
    hPx: module.projectedAlongSlopeM / input.mppImage,
    angleDeg: ((-module.planarRotationCartesianDeg % 360) + 360) % 360,
    footprintPx: metricPolygonToImage(module.projectedFootprint, adapter),
    slotIndex: module.slotIndex,
    faceAzimuthDeg: module.faceAzimuthDeg,
    nominalTiltDeg: module.nominalTiltDeg,
    effectiveTiltDeg: module.effectiveTiltDeg,
  }));
  return {
    ...validation,
    blockFootprintPx: metricPolygonToImage(block.footprint, adapter),
    modules,
  };
}

export function materializeManualAdvancedPanels(input: {
  candidate: ManualPlacementCandidate;
  roofId: string;
  config: AdvancedSurfacePlanningV1;
  layoutRunId: string;
  blockKey: string;
  montageFieldKey: string;
  thermalFieldKey?: string;
  createPanelId: (slotIndex: number) => string;
}): PanelInstance[] {
  if (!input.candidate.valid || !input.config.advanced.module.panelSpecId) return [];
  const system = input.config.advanced.system;
  const identity = system.systemId === K2_D_DOME_SYSTEM_ID
    ? { systemId: K2_D_DOME_SYSTEM_ID, adapterVersion: K2_D_DOME_ADAPTER_VERSION }
    : system.systemId === K2_S_DOME_SYSTEM_ID
      ? { systemId: K2_S_DOME_SYSTEM_ID, adapterVersion: K2_S_DOME_ADAPTER_VERSION }
      : system.systemId === GENERIC_SOUTH_SYSTEM_ID || system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
        ? { systemId: system.systemId, adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION }
        : null;
  if (!identity) return [];
  return input.candidate.modules.map((module) => ({
    id: input.createPanelId(module.slotIndex),
    roofId: input.roofId,
    cx: module.cx,
    cy: module.cy,
    wPx: module.wPx,
    hPx: module.hPx,
    angleDeg: module.angleDeg,
    orientation: input.config.advanced.module.orientation,
    panelId: input.config.advanced.module.panelSpecId!,
    advanced: {
      ...identity,
      layoutMode: "advanced",
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      blockKey: input.blockKey,
      montageFieldKey: input.montageFieldKey,
      ...(input.thermalFieldKey ? { thermalFieldKey: input.thermalFieldKey } : {}),
      slotIndex: module.slotIndex,
      nominalTiltDeg: module.nominalTiltDeg!,
      effectiveTiltDeg: module.effectiveTiltDeg!,
      moduleFaceAzimuthDeg: module.faceAzimuthDeg!,
      layoutRunId: input.layoutRunId,
    },
  }));
}

/**
 * Rebuilds flat-roof Montagefeld membership once after a successful manual commit.
 * It reconstructs only logical grid topology; panel/block coordinates are never changed.
 */
export function regroupK2PanelsAfterManualAdd(input: {
  panels: readonly PanelInstance[];
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  mppImage: number;
}): PanelInstance[] {
  const system = input.config.advanced.system;
  const isK2 = system.systemId === K2_D_DOME_SYSTEM_ID || system.systemId === K2_S_DOME_SYSTEM_ID;
  const isGenericFlat = input.config.surface.kind === "flat" && (
    system.systemId === GENERIC_SOUTH_SYSTEM_ID ||
    system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
  );
  if (!isK2 && !isGenericFlat) {
    return [...input.panels];
  }
  const definition = resolveManualAdvancedBlockDefinition(input.config);
  if (!definition) return [...input.panels];
  const adapter = imageAdapter(input.roof, input.mppImage);
  const grouped = new Map<string, PanelInstance[]>();
  input.panels.forEach((panel) => {
    if (
      panel.roofId !== input.roof.id ||
      panel.advanced?.systemId !== system.systemId ||
      !panel.advanced.blockKey
    ) return;
    const key = panel.advanced.blockKey;
    grouped.set(key, [...(grouped.get(key) ?? []), panel]);
  });
  if (!grouped.size) return [...input.panels];

  const centers = [...grouped.entries()].map(([blockKey, blockPanels]) => {
    const centerPx = {
      x: blockPanels.reduce((sum, panel) => sum + panel.cx, 0) / blockPanels.length,
      y: blockPanels.reduce((sum, panel) => sum + panel.cy, 0) / blockPanels.length,
    };
    return { blockKey, centerM: imagePointToMetric(centerPx, adapter) };
  });
  const rotation = instantiateAdvancedBlock({
    definition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  }).rotationCartesianDeg;
  const local = centers.map((block) => ({
    ...block,
    local: rotateMetricPoint(block.centerM, -rotation),
  }));
  const minX = Math.min(...local.map((block) => block.local.x));
  const minY = Math.min(...local.map((block) => block.local.y));
  const used = new Set<string>();
  const placed = [...local]
    .sort((a, b) => a.local.y - b.local.y || a.local.x - b.local.x || a.blockKey.localeCompare(b.blockKey))
    .map((block, blockIndex) => {
      let columnIndex = Math.round((block.local.x - minX) / definition.pitchM.x);
      let rowIndex = Math.round((block.local.y - minY) / definition.pitchM.y);
      let coordinate = `${rowIndex}:${columnIndex}`;
      if (used.has(coordinate)) {
        // A Shift-positioned off-grid block is kept as its own disconnected field.
        rowIndex = 100_000 + blockIndex * 2;
        columnIndex = 100_000 + blockIndex * 2;
        coordinate = `${rowIndex}:${columnIndex}`;
      }
      used.add(coordinate);
      return {
        ...instantiateAdvancedBlock({
          definition,
          centerM: block.centerM,
          blockIndex,
          columnIndex,
          rowIndex,
        }),
        blockKey: block.blockKey,
      };
    });
  const result = system.systemId === K2_D_DOME_SYSTEM_ID
    ? groupK2MontageFields({
        blocks: placed,
        moduleWidthM: input.config.advanced.module.widthM,
        moduleLengthM: input.config.advanced.module.heightM,
        rowSpaceM: system.rowSpaceM,
        pitchM: definition.pitchM,
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      })
    : system.systemId === K2_S_DOME_SYSTEM_ID
      ? groupK2MontageFields({
        blocks: placed,
        moduleWidthM: input.config.advanced.module.widthM,
        moduleLengthM: input.config.advanced.module.heightM,
        rowSpaceM: system.rowSpaceM,
        pitchM: definition.pitchM,
        systemId: K2_S_DOME_SYSTEM_ID,
        adapterVersion: K2_S_DOME_ADAPTER_VERSION,
      })
      : null;
  const fieldByBlock = result?.blockToFieldKey ?? Object.fromEntries(
    groupEffectiveMontageFields({ blocks: placed, pitchM: definition.pitchM })
      .flatMap((field) => field.blockKeys.map((blockKey) => [blockKey, field.fieldKey])),
  );
  const thermalFieldByBlock = input.config.thermalFieldLimits
    ? groupThermalFields({
        units: placed,
        pitchM: definition.pitchM,
        limits: input.config.thermalFieldLimits,
      }).unitToThermalFieldKey
    : {};
  return input.panels.map((panel) => {
    const blockKey = panel.advanced?.blockKey;
    const field = blockKey ? fieldByBlock[blockKey] : undefined;
    if (!field || !panel.advanced) return panel;
    return {
      ...panel,
      advanced: {
        ...panel.advanced,
        montageFieldKey: `${input.roof.id}:manual-regroup:${field}`,
        ...(blockKey && thermalFieldByBlock[blockKey]
          ? { thermalFieldKey: `${input.roof.id}:manual-regroup:${thermalFieldByBlock[blockKey]}` }
          : {}),
      },
    };
  });
}

/** Reassigns Standard thermal membership after a completed manual edit only. */
export function regroupStandardPanelsAfterManualCommit(input: {
  panels: readonly PanelInstance[];
  roof: RoofArea;
  modules: ModulesConfig;
  mppImage: number;
  limits: Extract<ThermalFieldLimits, { kind: "pitched-grid" }>;
}): PanelInstance[] {
  const roofPanels = input.panels.filter((panel) => panel.roofId === input.roof.id);
  if (!roofPanels.length || !(input.mppImage > 0)) return [...input.panels];
  const spacingX = input.modules.spacingXM ?? input.modules.spacingM;
  const spacingY = input.modules.spacingYM ?? input.modules.spacingM;
  const first = roofPanels[0];
  const grouping = groupRectangularThermalUnits({
    units: roofPanels.map((panel) => ({
      unitKey: panel.id,
      centerM: { x: panel.cx * input.mppImage, y: -panel.cy * input.mppImage },
      widthM: panel.wPx * input.mppImage,
      heightM: panel.hPx * input.mppImage,
      rotationCartesianDeg: -(panel.angleDeg ?? 0),
    })),
    pitchM: {
      x: first.wPx * input.mppImage + spacingX,
      y: first.hPx * input.mppImage + spacingY,
    },
    limits: input.limits,
  });
  return input.panels.map((panel) => {
    const thermalFieldKey = grouping.unitToThermalFieldKey[panel.id];
    if (!thermalFieldKey || !panel.standard) return panel;
    return { ...panel, standard: { ...panel.standard, thermalFieldKey } };
  });
}
