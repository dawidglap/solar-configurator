import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  expandBlockToModules,
  instantiateAdvancedBlock,
  resolveStandardModuleTilt,
  type AdvancedSurfacePlanningV1,
  type StandardModuleTiltInput,
  type StandardSurfacePlanningV1,
  type ThermalFieldLimits,
} from "@/lib/planning-core/advanced";
import {
  computeUsableRoof,
  GEOMETRY_V2_ENGINE_VERSION,
  imagePointToMetric,
  imagePolygonToMetric,
  metricPointToImage,
  rotateMetricPoint,
  validatePlacementFootprint,
  type ImageMetricAdapter,
  type MetricPoint,
  type MetricPolygon,
  type PolygonObstacle,
  type SegmentObstacle,
  type UsableRoofGeometry,
} from "@/lib/planning-core/geometry-v2";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import type { ModulesConfig, PanelInstance, Pt, RoofArea } from "@/types/planner";
import {
  buildStandardSurfacePlanning,
} from "../advanced/advancedPlanningApplication";
import {
  regroupK2PanelsAfterManualAdd,
  regroupStandardPanelsAfterManualCommit,
  resolveManualAdvancedBlockDefinition,
} from "../manualPlacement";

type ObstacleZone = { roofId: string; id?: string; type?: unknown; points: Pt[] };
type SnowGuard = { roofId: string; id?: string; p1: Pt; p2: Pt };

export type ExistingLayoutReflowResult = {
  panels: PanelInstance[];
  surfacePlanning: AdvancedSurfacePlanningV1 | StandardSurfacePlanningV1;
  modules?: ModulesConfig;
};

function imageAdapter(roof: RoofArea, mppImage: number): ImageMetricAdapter {
  const count = Math.max(1, roof.points.length);
  const metricOriginPx = roof.points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
  return { mppImage, metricOriginPx };
}

function withoutGeneratedFingerprint<T extends AdvancedSurfacePlanningV1 | StandardSurfacePlanningV1>(config: T): T {
  const next = { ...config };
  delete next.generatedLayoutFingerprint;
  return next;
}

function rectangle(center: MetricPoint, widthM: number, heightM: number, rotationDeg: number): MetricPolygon {
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -widthM / 2, y: -heightM / 2 },
    { x: widthM / 2, y: -heightM / 2 },
    { x: widthM / 2, y: heightM / 2 },
    { x: -widthM / 2, y: heightM / 2 },
  ].map((point) => ({
    x: center.x + point.x * cos - point.y * sin,
    y: center.y + point.x * sin + point.y * cos,
  }));
}

function strictlyOverlap(first: MetricPolygon, second: MetricPolygon): boolean {
  const axes = [first, second].flatMap((polygon) => polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
  }));
  return axes.every((axis) => {
    const project = (polygon: MetricPolygon) => polygon.map((point) => point.x * axis.x + point.y * axis.y);
    const a = project(first);
    const b = project(second);
    return Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) > 1e-7;
  });
}

type CandidateValidationContext = {
  usableRoof: UsableRoofGeometry;
  reservedZones: PolygonObstacle[];
  snowGuards: SegmentObstacle[];
};

function buildCandidateValidationContext(input: {
  roof: RoofArea;
  marginM: number;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
}): CandidateValidationContext {
  const adapter = imageAdapter(input.roof, input.mppImage);
  const usableRoof = computeUsableRoof({
    roofPolygonM: imagePolygonToMetric(input.roof.points, adapter),
    marginM: input.marginM,
  });
  const reservedZones = input.zones
    .filter((zone) => zone.roofId === input.roof.id && zone.type !== "walkway")
    .map((zone) => ({ id: zone.id, polygon: imagePolygonToMetric(zone.points, adapter) }));
  const snowGuards = input.snowGuards
    .filter((guard) => guard.roofId === input.roof.id)
    .map((guard) => ({
      id: guard.id,
      start: imagePointToMetric(guard.p1, adapter),
      end: imagePointToMetric(guard.p2, adapter),
      clearanceM: 0,
    }));
  return { usableRoof, reservedZones, snowGuards };
}

function isValidCandidateFootprint(
  footprint: MetricPolygon,
  context: CandidateValidationContext,
): boolean {
  if (footprint.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  return validatePlacementFootprint({
    footprint,
    usableRoof: context.usableRoof,
    reservedZones: context.reservedZones,
    snowGuards: context.snowGuards,
  }).valid;
}

function validateCandidateFootprints(
  footprints: readonly MetricPolygon[],
  context: CandidateValidationContext,
): boolean {
  if (footprints.some((footprint) => !isValidCandidateFootprint(footprint, context))) return false;
  for (let first = 0; first < footprints.length; first += 1) {
    for (let second = first + 1; second < footprints.length; second += 1) {
      if (strictlyOverlap(footprints[first], footprints[second])) return false;
    }
  }
  return true;
}

function systemIdentity(system: AdvancedSurfacePlanningV1["advanced"]["system"]) {
  if (system.systemId === K2_D_DOME_SYSTEM_ID) {
    return { systemId: K2_D_DOME_SYSTEM_ID, adapterVersion: K2_D_DOME_ADAPTER_VERSION } as const;
  }
  if (system.systemId === K2_S_DOME_SYSTEM_ID) {
    return { systemId: K2_S_DOME_SYSTEM_ID, adapterVersion: K2_S_DOME_ADAPTER_VERSION } as const;
  }
  return {
    systemId: system.systemId as typeof GENERIC_SOUTH_SYSTEM_ID | typeof GENERIC_EAST_WEST_SYSTEM_ID,
    adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
  } as const;
}

export function buildAdvancedExistingLayoutReflow(input: {
  roof: RoofArea;
  currentPanels: readonly PanelInstance[];
  previousConfig: AdvancedSurfacePlanningV1;
  nextConfig: AdvancedSurfacePlanningV1;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  /**
   * Wartungsgang is authoritative: keep the deterministic reference-edge
   * order and drop only placement units which cannot survive the reflow.
   * Other spacing controls retain their existing all-or-nothing policy.
   */
  pruneInvalidUnits?: boolean;
}): ExistingLayoutReflowResult | null {
  const roofPanels = input.currentPanels.filter((panel) => panel.roofId === input.roof.id);
  const nextConfig = withoutGeneratedFingerprint(input.nextConfig);
  if (!roofPanels.length) return { panels: [], surfacePlanning: nextConfig };
  if (
    !(input.mppImage > 0) ||
    roofPanels.some((panel) => !panel.advanced?.blockKey || (!input.pruneInvalidUnits && panel.locked))
  ) return null;

  const previousDefinition = resolveManualAdvancedBlockDefinition(input.previousConfig);
  const nextDefinition = resolveManualAdvancedBlockDefinition(nextConfig);
  if (!previousDefinition || !nextDefinition || previousDefinition.moduleSlots.length !== nextDefinition.moduleSlots.length) return null;

  const grouped = new Map<string, PanelInstance[]>();
  roofPanels.forEach((panel) => {
    const key = panel.advanced!.blockKey;
    grouped.set(key, [...(grouped.get(key) ?? []), panel]);
  });
  if ([...grouped.values()].some((panels) =>
    panels.length !== nextDefinition.moduleSlots.length ||
    new Set(panels.map((panel) => panel.advanced!.slotIndex)).size !== panels.length
  )) return null;

  const adapter = imageAdapter(input.roof, input.mppImage);
  const previousRotation = instantiateAdvancedBlock({
    definition: previousDefinition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  }).rotationCartesianDeg;
  const nextRotation = instantiateAdvancedBlock({
    definition: nextDefinition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    columnIndex: 0,
    rowIndex: 0,
  }).rotationCartesianDeg;
  const topology = [...grouped.entries()].map(([blockKey, panels]) => {
    const centerPx = {
      x: panels.reduce((sum, panel) => sum + panel.cx, 0) / panels.length,
      y: panels.reduce((sum, panel) => sum + panel.cy, 0) / panels.length,
    };
    return {
      blockKey,
      panels,
      local: rotateMetricPoint(imagePointToMetric(centerPx, adapter), -previousRotation),
    };
  }).sort((a, b) => a.local.y - b.local.y || a.local.x - b.local.x || a.blockKey.localeCompare(b.blockKey));
  const origin = {
    x: Math.min(...topology.map((unit) => unit.local.x)),
    y: Math.min(...topology.map((unit) => unit.local.y)),
  };

  const placed = topology.map((unit, blockIndex) => {
    const columnIndex = Math.round((unit.local.x - origin.x) / previousDefinition.pitchM.x);
    const rowIndex = Math.round((unit.local.y - origin.y) / previousDefinition.pitchM.y);
    const residual = {
      x: unit.local.x - origin.x - columnIndex * previousDefinition.pitchM.x,
      y: unit.local.y - origin.y - rowIndex * previousDefinition.pitchM.y,
    };
    const nextLocal = {
      x: origin.x + columnIndex * nextDefinition.pitchM.x + residual.x,
      y: origin.y + rowIndex * nextDefinition.pitchM.y + residual.y,
    };
    return {
      source: unit,
      columnIndex,
      rowIndex,
      block: instantiateAdvancedBlock({
        definition: nextDefinition,
        centerM: rotateMetricPoint(nextLocal, nextRotation),
        blockIndex,
        columnIndex,
        rowIndex,
      }),
    };
  });

  const validationContext = buildCandidateValidationContext({
    roof: input.roof,
    marginM: nextConfig.advanced.layout.marginM,
    mppImage: input.mppImage,
    zones: input.zones,
    snowGuards: input.snowGuards,
  });
  const retained = input.pruneInvalidUnits
    ? placed
      .slice()
      .sort((a, b) =>
        a.rowIndex - b.rowIndex ||
        a.columnIndex - b.columnIndex ||
        a.source.blockKey.localeCompare(b.source.blockKey)
      )
      .reduce<typeof placed>((accepted, candidate) => {
        if (!isValidCandidateFootprint(candidate.block.footprint, validationContext)) return accepted;
        if (accepted.some((unit) => strictlyOverlap(unit.block.footprint, candidate.block.footprint))) return accepted;
        accepted.push(candidate);
        return accepted;
      }, [])
    : placed;

  if (!validateCandidateFootprints(
    retained.map((unit) => unit.block.footprint),
    validationContext,
  )) return null;

  const identity = systemIdentity(nextConfig.advanced.system);
  const panels = retained.flatMap(({ source, block }) => {
    const modules = expandBlockToModules(block);
    return modules.map((module) => {
      const existing = source.panels.find((panel) => panel.advanced?.slotIndex === module.slotIndex)!;
      const center = metricPointToImage(module.centerM, adapter);
      return {
        ...existing,
        cx: center.x,
        cy: center.y,
        wPx: module.crossSlopeM / input.mppImage,
        hPx: module.projectedAlongSlopeM / input.mppImage,
        angleDeg: ((-module.planarRotationCartesianDeg % 360) + 360) % 360,
        orientation: nextConfig.advanced.module.orientation,
        panelId: nextConfig.advanced.module.panelSpecId ?? existing.panelId,
        advanced: {
          ...existing.advanced!,
          ...identity,
          layoutMode: "advanced" as const,
          advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
          geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
          blockKey: source.blockKey,
          slotIndex: module.slotIndex,
          nominalTiltDeg: module.nominalTiltDeg,
          effectiveTiltDeg: module.effectiveTiltDeg,
          moduleFaceAzimuthDeg: module.faceAzimuthDeg,
        },
      };
    });
  });
  const regrouped = regroupK2PanelsAfterManualAdd({
    panels,
    roof: input.roof,
    config: nextConfig,
    mppImage: input.mppImage,
  });
  return { panels: regrouped, surfacePlanning: nextConfig };
}

export function buildStandardExistingLayoutReflow(input: {
  roof: RoofArea;
  currentPanels: readonly PanelInstance[];
  previousModules: ModulesConfig;
  nextModules: ModulesConfig;
  moduleTilt: StandardModuleTiltInput;
  thermalFieldLimits: Extract<ThermalFieldLimits, { kind: "pitched-grid" }>;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
}): ExistingLayoutReflowResult | null {
  const roofPanels = input.currentPanels.filter((panel) => panel.roofId === input.roof.id);
  const config = withoutGeneratedFingerprint(buildStandardSurfacePlanning({
    roof: input.roof,
    moduleTilt: input.moduleTilt,
    moduleLayoutMode: input.nextModules.orientation,
    moduleSpacing: {
      horizontalM: input.nextModules.spacingXM ?? input.nextModules.spacingM,
      verticalM: input.nextModules.spacingYM ?? input.nextModules.spacingM,
    },
    thermalFieldLimits: input.thermalFieldLimits,
  }));
  if (!roofPanels.length) return { panels: [], surfacePlanning: config, modules: input.nextModules };
  if (!(input.mppImage > 0) || roofPanels.some((panel) => panel.advanced || panel.locked)) return null;
  const first = roofPanels[0];
  const angle = first.angleDeg;
  if (roofPanels.some((panel) => Math.abs(panel.angleDeg - angle) > 1e-6)) return null;
  const adapter = imageAdapter(input.roof, input.mppImage);
  const rotation = -angle;
  const oldPitch = {
    x: first.wPx * input.mppImage + (input.previousModules.spacingXM ?? input.previousModules.spacingM),
    y: first.hPx * input.mppImage + (input.previousModules.spacingYM ?? input.previousModules.spacingM),
  };
  const nextPitch = {
    x: first.wPx * input.mppImage + (input.nextModules.spacingXM ?? input.nextModules.spacingM),
    y: first.hPx * input.mppImage + (input.nextModules.spacingYM ?? input.nextModules.spacingM),
  };
  const local = roofPanels.map((panel) => ({
    panel,
    local: rotateMetricPoint(imagePointToMetric({ x: panel.cx, y: panel.cy }, adapter), -rotation),
  }));
  const origin = {
    x: Math.min(...local.map((item) => item.local.x)),
    y: Math.min(...local.map((item) => item.local.y)),
  };
  const tilt = resolveStandardModuleTilt({ moduleTilt: input.moduleTilt, roofSlopeDeg: input.roof.tiltDeg });
  const panels = local.map(({ panel, local: center }) => {
    const columnIndex = Math.round((center.x - origin.x) / oldPitch.x);
    const rowIndex = Math.round((center.y - origin.y) / oldPitch.y);
    const residual = {
      x: center.x - origin.x - columnIndex * oldPitch.x,
      y: center.y - origin.y - rowIndex * oldPitch.y,
    };
    const nextCenter = metricPointToImage(rotateMetricPoint({
      x: origin.x + columnIndex * nextPitch.x + residual.x,
      y: origin.y + rowIndex * nextPitch.y + residual.y,
    }, rotation), adapter);
    return {
      ...panel,
      cx: nextCenter.x,
      cy: nextCenter.y,
      ...(tilt.effectiveTiltDeg !== undefined
        ? { standard: {
            ...panel.standard,
            layoutMode: "standard" as const,
            moduleTiltMode: tilt.mode,
            effectiveTiltDeg: tilt.effectiveTiltDeg,
          } }
        : {}),
    };
  });
  const footprints = panels.map((panel) => rectangle(
    imagePointToMetric({ x: panel.cx, y: panel.cy }, adapter),
    panel.wPx * input.mppImage,
    panel.hPx * input.mppImage,
    -panel.angleDeg,
  ));
  const validationContext = buildCandidateValidationContext({
    roof: input.roof,
    marginM: resolveRoofEdgeMarginM(input.roof, input.nextModules.marginM),
    mppImage: input.mppImage,
    zones: input.zones,
    snowGuards: input.snowGuards,
  });
  if (!validateCandidateFootprints(footprints, validationContext)) return null;
  return {
    panels: regroupStandardPanelsAfterManualCommit({
      panels,
      roof: input.roof,
      modules: input.nextModules,
      mppImage: input.mppImage,
      limits: input.thermalFieldLimits,
    }),
    surfacePlanning: config,
    modules: input.nextModules,
  };
}
