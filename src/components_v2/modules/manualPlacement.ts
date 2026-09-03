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
): MetricPolygon[] {
  return panels
    .filter((panel) => panel.roofId === roofId)
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

function validate(input: {
  footprintM: MetricPolygon;
  roof: RoofArea;
  marginM: number;
  adapter: ImageMetricAdapter;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  panels: readonly PanelInstance[];
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
    committedPanelFootprints(input.panels, input.roof.id, input.adapter).some(
      (panelFootprint) => polygonsIntersectOrTouch(input.footprintM, panelFootprint),
    )
  ) {
    reasons.push("panel-overlap");
  }
  return { valid: reasons.length === 0, reasons };
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
      du < (wPx + panel.wPx) / 2 + (input.gapXM ?? 0) / input.mppImage &&
      dv < (hPx + panel.hPx) / 2 + (input.gapYM ?? 0) / input.mppImage
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
  let x = pointer.x;
  let y = pointer.y;
  let dxBest = 10;
  let dyBest = 10;
  for (const panel of input.panels) {
    if (panel.roofId !== input.roofId) continue;
    const angleDifference = Math.abs((((panel.angleDeg - input.angleDeg + 180) % 360) + 360) % 360 - 180);
    if (Math.min(angleDifference, Math.abs(180 - angleDifference)) > 5) continue;
    const center = toLocal({ x: panel.cx, y: panel.cy });
    const xTargets = [
      center.x,
      center.x - (input.widthPx + panel.wPx) / 2 - input.gapXPx,
      center.x + (input.widthPx + panel.wPx) / 2 + input.gapXPx,
    ];
    const yTargets = [
      center.y,
      center.y - (input.heightPx + panel.hPx) / 2 - input.gapYPx,
      center.y + (input.heightPx + panel.hPx) / 2 + input.gapYPx,
    ];
    xTargets.forEach((target) => {
      const distance = Math.abs(pointer.x - target);
      if (distance < dxBest) { dxBest = distance; x = target; }
    });
    yTargets.forEach((target) => {
      const distance = Math.abs(pointer.y - target);
      if (distance < dyBest) { dyBest = distance; y = target; }
    });
  }
  return toWorld({ x, y });
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

export function snapAdvancedManualCenter(input: {
  pointerPx: Pt;
  roofId: string;
  panels: readonly PanelInstance[];
  definition: AdvancedBlockDefinition;
  mppImage: number;
  disableSnap: boolean;
}): Pt {
  if (input.disableSnap) return input.pointerPx;
  const advanced = input.panels.filter(
    (panel) => panel.roofId === input.roofId && panel.advanced?.blockKey,
  );
  if (!advanced.length) return input.pointerPx;
  const byBlock = new Map<string, PanelInstance[]>();
  advanced.forEach((panel) => {
    const key = panel.advanced!.blockKey;
    byBlock.set(key, [...(byBlock.get(key) ?? []), panel]);
  });
  const centers = [...byBlock.values()].map((items) => ({
    x: items.reduce((sum, panel) => sum + panel.cx, 0) / items.length,
    y: items.reduce((sum, panel) => sum + panel.cy, 0) / items.length,
  }));
  const rotation = ((90 - input.definition.planarOrientationDeg) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let best = input.pointerPx;
  let bestDistance = 10;
  for (const origin of centers) {
    const dxM = (input.pointerPx.x - origin.x) * input.mppImage;
    const dyM = -(input.pointerPx.y - origin.y) * input.mppImage;
    const localX = dxM * cos + dyM * sin;
    const localY = -dxM * sin + dyM * cos;
    const snappedX = Math.round(localX / input.definition.pitchM.x) * input.definition.pitchM.x;
    const snappedY = Math.round(localY / input.definition.pitchM.y) * input.definition.pitchM.y;
    const worldX = snappedX * cos - snappedY * sin;
    const worldY = snappedX * sin + snappedY * cos;
    const candidate = {
      x: origin.x + worldX / input.mppImage,
      y: origin.y - worldY / input.mppImage,
    };
    const distance = Math.hypot(candidate.x - input.pointerPx.x, candidate.y - input.pointerPx.y);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
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
