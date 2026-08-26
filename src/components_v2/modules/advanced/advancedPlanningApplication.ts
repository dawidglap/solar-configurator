import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_SYSTEM_ID,
  SURFACE_PLANNING_SCHEMA_VERSION,
  calculateK2DDomeAllowedRowSpaceRangeMm,
  calculateK2DDomeOneBlockRailDepthMm,
  computeAdvancedBlockLayout,
  createK2DDomeBlock,
  createK2SDomeBlock,
  evaluateK2DDomeBlockLimits,
  resolveSurfacePlanning,
  type AdvancedGeometryWarning,
  type AdvancedSurfacePlanningV1,
  type SurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import {
  GEOMETRY_V2_ENGINE_VERSION,
  cartesianAngleToCanvasDeg,
  imagePointToMetric,
  imagePolygonToMetric,
  metricPointToImage,
  metricPolygonToImage,
  type ImageMetricAdapter,
} from "@/lib/planning-core/geometry-v2";
import type {
  ModulesConfig,
  PanelInstance,
  PanelSpec,
  Pt,
  RoofArea,
} from "@/types/planner";
import { computeLegacyStandardLayout } from "@/lib/planning-core/legacy-standard";
import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutSpacingM,
  selectLegacyStandardObstacles,
  STANDARD_AUTO_LAYOUT_POLICY,
} from "../legacyStandardApplicationPolicy";

export type AdvancedMountingOrientation = "south" | "east-west";

export type StandardPlanningDraft = {
  targetMode: "standard";
  panelSpecId: string;
  modules: ModulesConfig;
};

export type AdvancedPlanningDraft = {
  targetMode: "advanced";
  config: AdvancedSurfacePlanningV1;
};

export type RoofPlanningDraft =
  | StandardPlanningDraft
  | AdvancedPlanningDraft;

export type AdvancedPreviewError = {
  code: string;
  message: string;
  field: "module" | "rowSpace" | "surface" | "layout" | "system";
};

export type AdvancedPreviewModule = {
  blockKey: string;
  slotIndex: number;
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  angleDeg: number;
  footprintPx: Pt[];
  faceAzimuthDeg: number;
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
};

export type AdvancedPreviewBlock = {
  blockKey: string;
  centerPx: Pt;
  footprintPx: Pt[];
  rotationCanvasDeg: number;
};

export type AdvancedDerivedSummary = {
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  serviceCorridorM: number;
  oneBlockDepthM: number;
  moduleLongSideSpacingM: number;
  assemblyDimension1M: number;
  assemblyDimension2M: number;
  rowSpaceRangeM: { min: number; max: number };
};

export type AdvancedPlanningPreview =
  | {
      valid: false;
      errors: AdvancedPreviewError[];
      warnings: AdvancedGeometryWarning[];
      blocks: [];
      modules: [];
      blockCount: 0;
      moduleCount: 0;
      derived: null;
    }
  | {
      valid: true;
      errors: [];
      warnings: AdvancedGeometryWarning[];
      blocks: AdvancedPreviewBlock[];
      modules: AdvancedPreviewModule[];
      blockCount: number;
      moduleCount: number;
      derived: AdvancedDerivedSummary;
    };

type PreviewObstacleZone = {
  roofId: string;
  id?: string;
  points: Pt[];
};

type PreviewSnowGuard = {
  roofId: string;
  id?: string;
  p1: Pt;
  p2: Pt;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneModules(modules: ModulesConfig): ModulesConfig {
  return {
    ...modules,
    perRoofAngles: { ...(modules.perRoofAngles ?? {}) },
  };
}

function panelSnapshot(panel: PanelSpec) {
  return {
    panelSpecId: panel.id,
    widthM: panel.widthM,
    heightM: panel.heightM,
    orientation: "landscape" as const,
    powerW: panel.wp,
  };
}

export function getDefaultK2DDomeRowSpaceM(moduleWidthM: number): number {
  const widthMm = moduleWidthM * 1000;
  const allowed = calculateK2DDomeAllowedRowSpaceRangeMm(widthMm);
  const desired = calculateK2DDomeOneBlockRailDepthMm(widthMm) + 290;
  return clamp(desired, allowed.min, allowed.max) / 1000;
}

export function getDefaultK2SDomeRowSpaceM(): number {
  const range = K2_S_DOME_CONSTANTS_MM.rowSpace;
  return clamp(1500, range.min, range.max) / 1000;
}

export function createInitialAdvancedPlanning(input: {
  panel: PanelSpec;
  standardModules: ModulesConfig;
}): AdvancedSurfacePlanningV1 {
  let rowSpaceM = 2.6;
  try {
    rowSpaceM = getDefaultK2DDomeRowSpaceM(input.panel.widthM);
  } catch {
    // The adapter will expose the incompatible module; no K2 formula is copied here.
  }
  return {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: "flat", slopeDeg: 0, fallAzimuthDeg: 180 },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: panelSnapshot(input.panel),
      system: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
        rowSpaceM,
        primaryFaceAzimuthDeg: 90,
      },
      layout: {
        marginM: Math.max(0, input.standardModules.marginM ?? 0),
        phaseX: 0,
        phaseY: 0,
        anchorX: "start",
        anchorY: "start",
      },
    },
  };
}

export function createStandardPlanningDraft(input: {
  panelSpecId: string;
  modules: ModulesConfig;
}): StandardPlanningDraft {
  return {
    targetMode: "standard",
    panelSpecId: input.panelSpecId,
    modules: cloneModules(input.modules),
  };
}

export function replaceAdvancedDraftModule(input: {
  config: AdvancedSurfacePlanningV1;
  panel: PanelSpec;
}): AdvancedSurfacePlanningV1 {
  const config = input.config;
  const system = config.advanced.system;
  const nextSystem = system.systemId === K2_D_DOME_SYSTEM_ID
    ? {
        ...system,
        rowSpaceM: getDefaultK2DDomeRowSpaceM(input.panel.widthM),
      }
    : system.systemId === K2_S_DOME_SYSTEM_ID
      ? { ...system, rowSpaceM: getDefaultK2SDomeRowSpaceM() }
      : system;
  return {
    ...config,
    advanced: {
      ...config.advanced,
      module: panelSnapshot(input.panel),
      system: nextSystem,
    },
  };
}

export function setAdvancedMountingOrientation(input: {
  config: AdvancedSurfacePlanningV1;
  orientation: AdvancedMountingOrientation;
}): AdvancedSurfacePlanningV1 {
  const { config } = input;
  if (input.orientation === "south") {
    const previousAzimuth = config.advanced.system.systemId === K2_S_DOME_SYSTEM_ID
      ? config.advanced.system.faceAzimuthDeg
      : 180;
    return {
      ...config,
      advanced: {
        ...config.advanced,
        system: {
          systemId: K2_S_DOME_SYSTEM_ID,
          adapterVersion: K2_S_DOME_ADAPTER_VERSION,
          rowSpaceM: getDefaultK2SDomeRowSpaceM(),
          faceAzimuthDeg: previousAzimuth,
        },
      },
    };
  }
  const previousAzimuth = config.advanced.system.systemId === K2_D_DOME_SYSTEM_ID
    ? config.advanced.system.primaryFaceAzimuthDeg
    : 90;
  return {
    ...config,
    advanced: {
      ...config.advanced,
      system: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
        rowSpaceM: getDefaultK2DDomeRowSpaceM(config.advanced.module.widthM),
        primaryFaceAzimuthDeg: previousAzimuth,
      },
    },
  };
}

export function resolveRoofPlanningMode(input: {
  persisted: unknown;
  draft?: RoofPlanningDraft;
}): "standard" | "advanced" {
  if (input.draft) return input.draft.targetMode;
  return resolveSurfacePlanning(input.persisted).effectiveMode ?? "standard";
}

function imageAdapterForRoof(roof: RoofArea, mppImage: number): ImageMetricAdapter {
  const count = Math.max(1, roof.points.length);
  const center = roof.points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
  return { mppImage, metricOriginPx: center };
}

function mapAdapterError(code: string): AdvancedPreviewError {
  const moduleCodes = new Set([
    "invalid-module-width",
    "invalid-module-length",
    "module-width-below-range",
    "module-width-above-range",
    "module-length-below-range",
    "module-length-above-range",
    "unsupported-orientation",
  ]);
  const rowCodes = new Set([
    "invalid-row-space",
    "row-space-below-range",
    "row-space-above-range",
    "service-corridor-below-range",
    "service-corridor-above-range",
    "derived-geometry-impossible",
  ]);
  return {
    code,
    field: moduleCodes.has(code) ? "module" : rowCodes.has(code) ? "rowSpace" : "system",
    message: moduleCodes.has(code)
      ? "Das ausgewählte Modul ist mit K2 Dome 6.10 nicht kompatibel."
      : rowCodes.has(code)
        ? "Der Reihenabstand liegt ausserhalb der zulässigen K2 Geometrie."
        : "Die K2 Konfiguration ist ungültig.",
  };
}

function invalidPreview(
  errors: AdvancedPreviewError[],
  warnings: AdvancedGeometryWarning[] = [],
): AdvancedPlanningPreview {
  return {
    valid: false,
    errors,
    warnings,
    blocks: [],
    modules: [],
    blockCount: 0,
    moduleCount: 0,
    derived: null,
  };
}

export function computeAdvancedPlanningPreview(input: {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  mppImage: number;
  zones?: PreviewObstacleZone[];
  snowGuards?: PreviewSnowGuard[];
}): AdvancedPlanningPreview {
  if (!(input.mppImage > 0) || input.roof.points.length < 3) {
    return invalidPreview([
      { code: "invalid-surface", field: "surface", message: "Die Dachfläche oder Bildskalierung ist ungültig." },
    ]);
  }
  if (input.config.surface.kind !== "flat") {
    return invalidPreview([
      { code: "unsupported-surface-kind", field: "surface", message: "Advanced V1 unterstützt nur Flachdächer." },
    ]);
  }

  const resolved = resolveSurfacePlanning(input.config);
  if (resolved.status !== "supported-advanced") {
    return invalidPreview([
      { code: "invalid-persisted-input", field: "system", message: "Die Advanced-Konfiguration ist unvollständig." },
    ]);
  }
  const config = resolved.config;
  const system = config.advanced.system;
  const moduleSpec = config.advanced.module;
  const adapterResult = system.systemId === K2_D_DOME_SYSTEM_ID
    ? createK2DDomeBlock({
        module: moduleSpec,
        rowSpaceM: system.rowSpaceM,
        primaryFaceAzimuthDeg: system.primaryFaceAzimuthDeg,
      })
    : system.systemId === K2_S_DOME_SYSTEM_ID
      ? createK2SDomeBlock({
          module: moduleSpec,
          rowSpaceM: system.rowSpaceM,
          faceAzimuthDeg: system.faceAzimuthDeg,
        })
      : null;
  if (!adapterResult) {
    return invalidPreview([
      { code: "unsupported-ui-system", field: "system", message: "Dieses Montagesystem ist in der Oberfläche noch nicht verfügbar." },
    ]);
  }
  if (!adapterResult.valid) {
    return invalidPreview(adapterResult.errors.map((error) => mapAdapterError(error.code)));
  }

  const imageAdapter = imageAdapterForRoof(input.roof, input.mppImage);
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: imagePolygonToMetric(input.roof.points, imageAdapter),
    marginM: config.advanced.layout.marginM,
    blockDefinition: adapterResult.definition,
    phaseX: config.advanced.layout.phaseX,
    phaseY: config.advanced.layout.phaseY,
    anchorX: config.advanced.layout.anchorX,
    anchorY: config.advanced.layout.anchorY,
    reservedZones: (input.zones ?? [])
      .filter((zone) => zone.roofId === input.roof.id)
      .map((zone) => ({ id: zone.id, polygon: imagePolygonToMetric(zone.points, imageAdapter) })),
    snowGuards: (input.snowGuards ?? [])
      .filter((guard) => guard.roofId === input.roof.id)
      .map((guard) => ({
        id: guard.id,
        start: imagePointToMetric(guard.p1, imageAdapter),
        end: imagePointToMetric(guard.p2, imageAdapter),
        clearanceM: 0,
      })),
  });
  const modules = layout.modules.map((module) => ({
    blockKey: module.blockKey,
    slotIndex: module.slotIndex,
    cx: metricPointToImage(module.centerM, imageAdapter).x,
    cy: metricPointToImage(module.centerM, imageAdapter).y,
    wPx: module.crossSlopeM / input.mppImage,
    hPx: module.projectedAlongSlopeM / input.mppImage,
    angleDeg: cartesianAngleToCanvasDeg(module.planarRotationCartesianDeg),
    footprintPx: metricPolygonToImage(module.projectedFootprint, imageAdapter),
    faceAzimuthDeg: module.faceAzimuthDeg,
    nominalTiltDeg: module.nominalTiltDeg,
    effectiveTiltDeg: module.effectiveTiltDeg,
  }));
  const blocks = layout.blocks.map((block) => ({
    blockKey: block.blockKey,
    centerPx: metricPointToImage(block.centerM, imageAdapter),
    footprintPx: metricPolygonToImage(block.footprint, imageAdapter),
    rotationCanvasDeg: cartesianAngleToCanvasDeg(block.rotationCartesianDeg),
  }));
  const derivedDimensions = adapterResult.derivedDimensions;
  const isDDome = system.systemId === K2_D_DOME_SYSTEM_ID;
  const rowSpaceRangeM = isDDome
    ? (() => {
        const range = calculateK2DDomeAllowedRowSpaceRangeMm(moduleSpec.widthM * 1000);
        return { min: range.min / 1000, max: range.max / 1000 };
      })()
    : {
        min: K2_S_DOME_CONSTANTS_MM.rowSpace.min / 1000,
        max: K2_S_DOME_CONSTANTS_MM.rowSpace.max / 1000,
      };
  const warnings = [...adapterResult.warnings];
  if (isDDome && layout.blocks.length) {
    const limits = evaluateK2DDomeBlockLimits({
      moduleWidthM: moduleSpec.widthM,
      moduleLengthM: moduleSpec.heightM,
      rowSpaceM: system.rowSpaceM,
      quantityRows: new Set(layout.blocks.map((block) => block.rowIndex)).size,
      numberOfColumns: new Set(layout.blocks.map((block) => block.columnIndex)).size,
    });
    warnings.push(...limits.warnings);
  }

  return {
    valid: true,
    errors: [],
    warnings,
    blocks,
    modules,
    blockCount: layout.blockCount,
    moduleCount: layout.moduleCount,
    derived: {
      nominalTiltDeg: derivedDimensions.nominalTiltDeg,
      effectiveTiltDeg: derivedDimensions.effectiveTiltDeg,
      serviceCorridorM: derivedDimensions.serviceCorridorM,
      oneBlockDepthM: "oneBlockRailDepthM" in derivedDimensions
        ? derivedDimensions.oneBlockRailDepthM
        : derivedDimensions.blockFootprintRailDirectionM,
      moduleLongSideSpacingM: derivedDimensions.moduleLongSideSpacingM,
      assemblyDimension1M: derivedDimensions.assemblyDimension1M,
      assemblyDimension2M: derivedDimensions.assemblyDimension2M,
      rowSpaceRangeM,
    },
  };
}

export function materializeAdvancedPanels(input: {
  roofId: string;
  config: AdvancedSurfacePlanningV1;
  preview: AdvancedPlanningPreview;
  layoutRunId: string;
  createPanelId: (index: number) => string;
}): PanelInstance[] {
  if (!input.preview.valid || !input.config.advanced.module.panelSpecId) return [];
  const system = input.config.advanced.system;
  const systemIdentity = system.systemId === K2_D_DOME_SYSTEM_ID
    ? {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      } as const
    : system.systemId === K2_S_DOME_SYSTEM_ID
      ? {
          systemId: K2_S_DOME_SYSTEM_ID,
          adapterVersion: K2_S_DOME_ADAPTER_VERSION,
        } as const
      : null;
  if (!systemIdentity) return [];
  return input.preview.modules.map((module, index) => ({
    id: input.createPanelId(index),
    roofId: input.roofId,
    cx: module.cx,
    cy: module.cy,
    wPx: module.wPx,
    hPx: module.hPx,
    angleDeg: module.angleDeg,
    orientation: input.config.advanced.module.orientation,
    panelId: input.config.advanced.module.panelSpecId as string,
    advanced: {
      ...systemIdentity,
      layoutMode: "advanced",
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      blockKey: `${input.roofId}:${input.layoutRunId}:${module.blockKey}`,
      slotIndex: module.slotIndex,
      nominalTiltDeg: module.nominalTiltDeg,
      effectiveTiltDeg: module.effectiveTiltDeg,
      moduleFaceAzimuthDeg: module.faceAzimuthDeg,
      layoutRunId: input.layoutRunId,
    },
  }));
}

export function applyRoofLayoutTransaction<T extends RoofArea>(input: {
  roofs: readonly T[];
  panels: readonly PanelInstance[];
  roofId: string;
  nextPanels: PanelInstance[];
  surfacePlanning?: SurfacePlanningV1;
}): { roofs: T[]; panels: PanelInstance[] } {
  return {
    roofs: input.roofs.map((roof) => {
      if (roof.id !== input.roofId) return roof;
      if (input.surfacePlanning) return { ...roof, surfacePlanning: input.surfacePlanning };
      const next = { ...roof };
      delete next.surfacePlanning;
      return next;
    }),
    panels: [
      ...input.panels.filter((panel) => panel.roofId !== input.roofId),
      ...input.nextPanels.map((panel) => ({ ...panel, roofId: input.roofId })),
    ],
  };
}

export function hasCommittedPanelsForRoof(
  panels: readonly Pick<PanelInstance, "roofId">[],
  roofId: string,
): boolean {
  return panels.some((panel) => panel.roofId === roofId);
}

export function computeStandardDraftPanels(input: {
  roof: RoofArea;
  panel: PanelSpec;
  modules: ModulesConfig;
  mppImage: number;
  zones: Parameters<typeof selectLegacyStandardObstacles>[0];
  snowGuards: Parameters<typeof selectLegacyStandardObstacles>[1];
  createPanelId: (index: number) => string;
}): PanelInstance[] {
  const obstacles = selectLegacyStandardObstacles(
    input.zones,
    input.snowGuards,
    input.roof.id,
  );
  const layout = computeLegacyStandardLayout({
    generation: {
      roofPolygon: input.roof.points,
      mppImage: input.mppImage,
      canvasAngleDeg: resolveStandardAutoLayoutCanvasAngle({
        roofId: input.roof.id,
        roofPolygon: input.roof.points,
        legacyRoofAzimuthDeg: input.roof.azimuthDeg,
        gridAngleDeg: input.modules.gridAngleDeg,
        perRoofAngles: input.modules.perRoofAngles,
      }),
      orientation: input.modules.orientation,
      panelSizeM: { widthM: input.panel.widthM, heightM: input.panel.heightM },
      spacingM: resolveStandardAutoLayoutSpacingM(input.modules.spacingM),
      marginM: input.modules.marginM,
      phaseX: input.modules.gridPhaseX ?? 0,
      phaseY: input.modules.gridPhaseY ?? 0,
      anchorX: input.modules.gridAnchorX ?? "start",
      anchorY: input.modules.gridAnchorY ?? "start",
      coverageRatio: input.modules.coverageRatio ?? 1,
    },
    reservedZones: obstacles.reservedZones,
    snowGuards: obstacles.snowGuards,
    filterPolicy: STANDARD_AUTO_LAYOUT_POLICY.filterPolicy,
  });
  return layout.placements.map((placement, index) => ({
    id: input.createPanelId(index),
    roofId: input.roof.id,
    cx: placement.cx,
    cy: placement.cy,
    wPx: placement.wPx,
    hPx: placement.hPx,
    angleDeg: placement.angleDeg,
    orientation: input.modules.orientation,
    panelId: input.panel.id,
  }));
}
