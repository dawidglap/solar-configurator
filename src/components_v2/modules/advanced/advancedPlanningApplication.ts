import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  GREEN_ROOF_GENERIC_DEFAULTS,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_SYSTEM_ID,
  SURFACE_PLANNING_SCHEMA_VERSION,
  MAX_FIXED_BLOCKS_PER_AXIS,
  calculateK2DDomeAllowedRowSpaceRangeMm,
  calculateK2DDomeOneBlockRailDepthMm,
  computeAdvancedBlockLayout,
  computeFixedAdvancedBlockLayout,
  createGenericEastWestBlock,
  createGenericSouthBlock,
  createK2DDomeBlock,
  createK2SDomeBlock,
  evaluateK2DDomeBlockLimits,
  resolveSurfacePlanning,
  resolveK2ParallelRoofEdgeAlignment,
  validateGreenRoofGenericInputs,
  type AdvancedBlockDefinition,
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
  field: "module" | "rowSpace" | "surface" | "layout" | "system" | "quantity";
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
  valid: boolean;
  invalidReasons: Array<"outside-usable-roof" | "reserved-zone" | "snow-guard">;
};

export type AdvancedQuantitySummary =
  | {
      mode: "auto";
      requestedBlockCount: number;
      validBlockCount: number;
      requestedModuleCount: number;
      validModuleCount: number;
    }
  | {
      mode: "fixed";
      blocksPerRow: number;
      rowCount: number;
      requestedBlockCount: number;
      validBlockCount: number;
      requestedModuleCount: number;
      validModuleCount: number;
    };

export type AdvancedK2DerivedSummary = {
  kind: "k2";
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  serviceCorridorM: number;
  oneBlockDepthM: number;
  moduleLongSideSpacingM: number;
  assemblyDimension1M: number;
  assemblyDimension2M: number;
  rowSpaceRangeM: { min: number; max: number };
};

export type AdvancedGenericDerivedSummary = {
  kind: "generic";
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  pitchXM: number;
  pitchYM: number;
  blockDepthM: number;
  moduleGapXM: number;
  moduleGapYM: number;
  blockGapXM: number;
  blockGapYM: number;
};

export type AdvancedDerivedSummary =
  | AdvancedK2DerivedSummary
  | AdvancedGenericDerivedSummary;

export type AdvancedPlanningPreview =
  | {
      valid: false;
      errors: AdvancedPreviewError[];
      warnings: AdvancedGeometryWarning[];
      blocks: AdvancedPreviewBlock[];
      modules: AdvancedPreviewModule[];
      blockCount: number;
      moduleCount: number;
      derived: null;
      quantity: AdvancedQuantitySummary | null;
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
      quantity: AdvancedQuantitySummary;
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

function panelSnapshot(
  panel: PanelSpec,
  orientation: "portrait" | "landscape" = "landscape",
) {
  return {
    panelSpecId: panel.id,
    widthM: panel.widthM,
    heightM: panel.heightM,
    orientation,
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

function getSafeDefaultK2DDomeRowSpaceM(moduleWidthM: number): number {
  try {
    return getDefaultK2DDomeRowSpaceM(moduleWidthM);
  } catch {
    return 2.6;
  }
}

export function createInitialAdvancedPlanning(input: {
  panel: PanelSpec;
  standardModules: ModulesConfig;
}): AdvancedSurfacePlanningV1 {
  const rowSpaceM = getSafeDefaultK2DDomeRowSpaceM(input.panel.widthM);
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
      module: panelSnapshot(
        input.panel,
        system.systemId === GENERIC_SOUTH_SYSTEM_ID ||
          system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
          ? config.advanced.module.orientation
          : "landscape",
      ),
      system: nextSystem,
    },
  };
}

function genericSouthSystem(input?: {
  faceAzimuthDeg?: number;
  nominalTiltDeg?: number;
}) {
  return {
    systemId: GENERIC_SOUTH_SYSTEM_ID,
    adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
    nominalTiltDeg:
      input?.nominalTiltDeg ?? GREEN_ROOF_GENERIC_DEFAULTS.nominalTiltDeg,
    faceAzimuthDeg: input?.faceAzimuthDeg ?? 180,
    moduleGapX: GREEN_ROOF_GENERIC_DEFAULTS.moduleGapX,
    moduleGapY: GREEN_ROOF_GENERIC_DEFAULTS.moduleGapY,
    blockGapX: GREEN_ROOF_GENERIC_DEFAULTS.blockGapX,
    blockGapY: GREEN_ROOF_GENERIC_DEFAULTS.blockGapY,
  } as const;
}

function genericEastWestSystem(input?: {
  primaryFaceAzimuthDeg?: number;
  nominalTiltDeg?: number;
}) {
  return {
    systemId: GENERIC_EAST_WEST_SYSTEM_ID,
    adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
    nominalTiltDeg:
      input?.nominalTiltDeg ?? GREEN_ROOF_GENERIC_DEFAULTS.nominalTiltDeg,
    primaryFaceAzimuthDeg: input?.primaryFaceAzimuthDeg ?? 90,
    interModuleGapM: GREEN_ROOF_GENERIC_DEFAULTS.moduleGapY,
    moduleGapX: GREEN_ROOF_GENERIC_DEFAULTS.moduleGapX,
    blockGapX: GREEN_ROOF_GENERIC_DEFAULTS.blockGapX,
    blockGapY: GREEN_ROOF_GENERIC_DEFAULTS.blockGapY,
  } as const;
}

export function setAdvancedSurfaceKind(input: {
  config: AdvancedSurfacePlanningV1;
  kind: "flat" | "green";
}): AdvancedSurfacePlanningV1 {
  const { config } = input;
  if (config.surface.kind === input.kind) return config;
  const currentSystem = config.advanced.system;
  if (input.kind === "green") {
    const south =
      currentSystem.systemId === K2_S_DOME_SYSTEM_ID ||
      currentSystem.systemId === GENERIC_SOUTH_SYSTEM_ID;
    const system = south
      ? genericSouthSystem({
          faceAzimuthDeg:
            "faceAzimuthDeg" in currentSystem
              ? currentSystem.faceAzimuthDeg
              : 180,
        })
      : genericEastWestSystem({
          primaryFaceAzimuthDeg:
            "primaryFaceAzimuthDeg" in currentSystem
              ? currentSystem.primaryFaceAzimuthDeg
              : 90,
        });
    return {
      ...config,
      surface: { ...config.surface, kind: "green" },
      advanced: {
        ...config.advanced,
        undersideClearanceM:
          config.advanced.undersideClearanceM ??
          GREEN_ROOF_GENERIC_DEFAULTS.undersideClearanceM,
        system,
      },
    };
  }

  const south =
    currentSystem.systemId === GENERIC_SOUTH_SYSTEM_ID ||
    currentSystem.systemId === K2_S_DOME_SYSTEM_ID;
  const advancedWithoutClearance = { ...config.advanced };
  delete advancedWithoutClearance.undersideClearanceM;
  return {
    ...config,
    surface: { ...config.surface, kind: "flat" },
    advanced: {
      ...advancedWithoutClearance,
      module: { ...config.advanced.module, orientation: "landscape" },
      system: south
        ? {
            systemId: K2_S_DOME_SYSTEM_ID,
            adapterVersion: K2_S_DOME_ADAPTER_VERSION,
            rowSpaceM: getDefaultK2SDomeRowSpaceM(),
            faceAzimuthDeg:
              "faceAzimuthDeg" in currentSystem
                ? currentSystem.faceAzimuthDeg
                : 180,
          }
        : {
            systemId: K2_D_DOME_SYSTEM_ID,
            adapterVersion: K2_D_DOME_ADAPTER_VERSION,
            rowSpaceM: getSafeDefaultK2DDomeRowSpaceM(
              config.advanced.module.widthM,
            ),
            primaryFaceAzimuthDeg:
              "primaryFaceAzimuthDeg" in currentSystem
                ? currentSystem.primaryFaceAzimuthDeg
                : 90,
          },
    },
  };
}

export function setAdvancedModuleOrientation(input: {
  config: AdvancedSurfacePlanningV1;
  orientation: "portrait" | "landscape";
}): AdvancedSurfacePlanningV1 {
  if (input.config.surface.kind !== "green") return input.config;
  return {
    ...input.config,
    advanced: {
      ...input.config.advanced,
      module: {
        ...input.config.advanced.module,
        orientation: input.orientation,
      },
    },
  };
}

export function setAdvancedMountingOrientation(input: {
  config: AdvancedSurfacePlanningV1;
  orientation: AdvancedMountingOrientation;
}): AdvancedSurfacePlanningV1 {
  const { config } = input;
  if (config.surface.kind === "green") {
    const current = config.advanced.system;
    return {
      ...config,
      advanced: {
        ...config.advanced,
        system:
          input.orientation === "south"
            ? current.systemId === GENERIC_SOUTH_SYSTEM_ID
              ? current
              : genericSouthSystem({
                  nominalTiltDeg:
                    "nominalTiltDeg" in current
                      ? current.nominalTiltDeg
                      : undefined,
                })
            : current.systemId === GENERIC_EAST_WEST_SYSTEM_ID
              ? current
              : genericEastWestSystem({
                  nominalTiltDeg:
                    "nominalTiltDeg" in current
                      ? current.nominalTiltDeg
                      : undefined,
                }),
      },
    };
  }
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
        rowSpaceM: getSafeDefaultK2DDomeRowSpaceM(config.advanced.module.widthM),
        primaryFaceAzimuthDeg: previousAzimuth,
      },
    },
  };
}

export function setAdvancedQuantityMode(input: {
  config: AdvancedSurfacePlanningV1;
  mode: "auto" | "fixed";
}): AdvancedSurfacePlanningV1 {
  const layout = { ...input.config.advanced.layout };
  if (input.mode === "auto") {
    delete layout.quantityMode;
    delete layout.blocksPerRow;
    delete layout.rowCount;
  } else {
    layout.quantityMode = "fixed";
    layout.blocksPerRow = layout.blocksPerRow ?? 5;
    layout.rowCount = layout.rowCount ?? 3;
    layout.anchorX = "center";
    layout.anchorY = "center";
  }
  return {
    ...input.config,
    advanced: { ...input.config.advanced, layout },
  };
}

export function setAdvancedFixedQuantity(input: {
  config: AdvancedSurfacePlanningV1;
  blocksPerRow?: number;
  rowCount?: number;
}): AdvancedSurfacePlanningV1 {
  const current = input.config.advanced.layout;
  const blocksPerRow = input.blocksPerRow ?? current.blocksPerRow ?? 5;
  const rowCount = input.rowCount ?? current.rowCount ?? 3;
  if (
    !Number.isInteger(blocksPerRow) ||
    blocksPerRow <= 0 ||
    blocksPerRow > MAX_FIXED_BLOCKS_PER_AXIS ||
    !Number.isInteger(rowCount) ||
    rowCount <= 0 ||
    rowCount > MAX_FIXED_BLOCKS_PER_AXIS
  ) {
    return input.config;
  }
  return {
    ...input.config,
    advanced: {
      ...input.config.advanced,
      layout: {
        ...current,
        quantityMode: "fixed",
        blocksPerRow,
        rowCount,
      },
    },
  };
}

export function alignAdvancedLayoutParallelToRoofEdge(input: {
  config: AdvancedSurfacePlanningV1;
  roof: Pick<RoofArea, "points">;
  mppImage: number;
}): AdvancedSurfacePlanningV1 {
  const alignment = resolveK2ParallelRoofEdgeAlignment({
    roofPointsPx: input.roof.points,
    mppImage: input.mppImage,
  });
  if (!alignment) return input.config;
  const system = input.config.advanced.system;
  if (system.systemId === K2_S_DOME_SYSTEM_ID) {
    return {
      ...input.config,
      advanced: {
        ...input.config.advanced,
        system: { ...system, faceAzimuthDeg: alignment.faceAzimuthDeg },
      },
    };
  }
  if (system.systemId === K2_D_DOME_SYSTEM_ID) {
    return {
      ...input.config,
      advanced: {
        ...input.config.advanced,
        system: {
          ...system,
          primaryFaceAzimuthDeg: alignment.faceAzimuthDeg,
        },
      },
    };
  }
  return input.config;
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
  partial?: {
    blocks: AdvancedPreviewBlock[];
    modules: AdvancedPreviewModule[];
    blockCount: number;
    moduleCount: number;
    quantity: AdvancedQuantitySummary;
  },
): AdvancedPlanningPreview {
  return {
    valid: false,
    errors,
    warnings,
    blocks: partial?.blocks ?? [],
    modules: partial?.modules ?? [],
    blockCount: partial?.blockCount ?? 0,
    moduleCount: partial?.moduleCount ?? 0,
    derived: null,
    quantity: partial?.quantity ?? null,
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
  if (
    input.config.surface.kind !== "flat" &&
    input.config.surface.kind !== "green"
  ) {
    return invalidPreview([
      { code: "unsupported-surface-kind", field: "surface", message: "Advanced unterstützt Flach- und Gründächer." },
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
  const isGreenRoof = config.surface.kind === "green";
  const isGenericSystem =
    system.systemId === GENERIC_SOUTH_SYSTEM_ID ||
    system.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  if (isGreenRoof !== isGenericSystem) {
    return invalidPreview([
      {
        code: "surface-system-mismatch",
        field: "system",
        message: isGreenRoof
          ? "Gründach verwendet die freie Vorplanung, nicht K2 Dome Classic."
          : "Flachdach verwendet weiterhin K2 Dome Classic.",
      },
    ]);
  }

  let blockDefinition: AdvancedBlockDefinition;
  let warnings: AdvancedGeometryWarning[] = [];
  let k2DerivedDimensions:
    | (Record<string, number> & {
        nominalTiltDeg: number;
        effectiveTiltDeg: number;
        serviceCorridorM: number;
        moduleLongSideSpacingM: number;
        assemblyDimension1M: number;
        assemblyDimension2M: number;
      })
    | undefined;

  if (isGreenRoof) {
    if (
      system.systemId !== GENERIC_SOUTH_SYSTEM_ID &&
      system.systemId !== GENERIC_EAST_WEST_SYSTEM_ID
    ) {
      return invalidPreview([
        { code: "unsupported-ui-system", field: "system", message: "Dieses freie Montagesystem ist nicht verfügbar." },
      ]);
    }
    const greenIssues = validateGreenRoofGenericInputs({
      undersideClearanceM: config.advanced.undersideClearanceM,
      nominalTiltDeg: system.nominalTiltDeg,
      spacingsM:
        system.systemId === GENERIC_SOUTH_SYSTEM_ID
          ? [
              system.moduleGapX ?? 0,
              system.moduleGapY ?? 0,
              system.blockGapX,
              system.blockGapY,
            ]
          : [
              system.moduleGapX ?? 0,
              system.interModuleGapM,
              system.blockGapX,
              system.blockGapY,
            ],
    });
    if (greenIssues.length) {
      return invalidPreview(
        greenIssues.map((current) => ({
          code: current.code,
          field:
            current.field === "undersideClearanceM"
              ? "surface"
              : current.field === "nominalTiltDeg"
                ? "system"
                : "layout",
          message: current.message,
        })),
      );
    }
    blockDefinition =
      system.systemId === GENERIC_SOUTH_SYSTEM_ID
        ? createGenericSouthBlock({
            module: moduleSpec,
            nominalTiltDeg: system.nominalTiltDeg,
            faceAzimuthDeg: system.faceAzimuthDeg,
            moduleGapX: system.moduleGapX,
            moduleGapY: system.moduleGapY,
            blockGapX: system.blockGapX,
            blockGapY: system.blockGapY,
          })
        : createGenericEastWestBlock({
            module: moduleSpec,
            nominalTiltDeg: system.nominalTiltDeg,
            primaryFaceAzimuthDeg: system.primaryFaceAzimuthDeg,
            interModuleGapM: system.interModuleGapM,
            moduleGapX: system.moduleGapX,
            blockGapX: system.blockGapX,
            blockGapY: system.blockGapY,
          });
  } else {
    const adapterResult =
      system.systemId === K2_D_DOME_SYSTEM_ID
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
      return invalidPreview(
        adapterResult.errors.map((error) => mapAdapterError(error.code)),
      );
    }
    blockDefinition = adapterResult.definition;
    warnings = [...adapterResult.warnings];
    k2DerivedDimensions = adapterResult.derivedDimensions;
  }

  const imageAdapter = imageAdapterForRoof(input.roof, input.mppImage);
  const commonLayoutInput = {
    roofPolygonM: imagePolygonToMetric(input.roof.points, imageAdapter),
    marginM: config.advanced.layout.marginM,
    blockDefinition,
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
  };
  const fixedLayout = config.advanced.layout.quantityMode === "fixed"
    ? computeFixedAdvancedBlockLayout({
        ...commonLayoutInput,
        blocksPerRow: config.advanced.layout.blocksPerRow as number,
        rowCount: config.advanced.layout.rowCount as number,
      })
    : null;
  const automaticLayout = fixedLayout
    ? null
    : computeAdvancedBlockLayout(commonLayoutInput);
  const placedBlocks = fixedLayout
    ? fixedLayout.validBlocks
    : automaticLayout?.blocks ?? [];
  const placedModules = fixedLayout
    ? fixedLayout.validModules
    : automaticLayout?.modules ?? [];
  const modules = placedModules.map((module) => ({
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
  const blocks: AdvancedPreviewBlock[] = fixedLayout
    ? fixedLayout.candidates.map((candidate) => ({
        blockKey: candidate.block.blockKey,
        centerPx: metricPointToImage(candidate.block.centerM, imageAdapter),
        footprintPx: metricPolygonToImage(candidate.block.footprint, imageAdapter),
        rotationCanvasDeg: cartesianAngleToCanvasDeg(candidate.block.rotationCartesianDeg),
        valid: candidate.valid,
        invalidReasons: [...candidate.reasons],
      }))
    : placedBlocks.map((block) => ({
        blockKey: block.blockKey,
        centerPx: metricPointToImage(block.centerM, imageAdapter),
        footprintPx: metricPolygonToImage(block.footprint, imageAdapter),
        rotationCanvasDeg: cartesianAngleToCanvasDeg(block.rotationCartesianDeg),
        valid: true,
        invalidReasons: [],
      }));
  const quantity: AdvancedQuantitySummary = fixedLayout
    ? {
        mode: "fixed",
        blocksPerRow: config.advanced.layout.blocksPerRow as number,
        rowCount: config.advanced.layout.rowCount as number,
        requestedBlockCount: fixedLayout.requestedBlockCount,
        validBlockCount: fixedLayout.validBlockCount,
        requestedModuleCount: fixedLayout.requestedModuleCount,
        validModuleCount: fixedLayout.validModuleCount,
      }
    : {
        mode: "auto",
        requestedBlockCount: placedBlocks.length,
        validBlockCount: placedBlocks.length,
        requestedModuleCount: placedModules.length,
        validModuleCount: placedModules.length,
      };

  if (fixedLayout && !fixedLayout.complete) {
    return invalidPreview(
      [{
        code: "fixed-layout-incomplete",
        field: "quantity",
        message: `Die gewünschte Anordnung ${config.advanced.layout.blocksPerRow} × ${config.advanced.layout.rowCount} passt nicht vollständig auf diese Dachfläche. ${fixedLayout.validBlockCount} von ${fixedLayout.requestedBlockCount} Blöcken sind gültig.`,
      }],
      warnings,
      {
        blocks,
        modules,
        blockCount: fixedLayout.validBlockCount,
        moduleCount: fixedLayout.validModuleCount,
        quantity,
      },
    );
  }
  if (isGreenRoof) {
    const genericSystem = system.systemId === GENERIC_SOUTH_SYSTEM_ID
      ? system
      : system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
        ? system
        : null;
    if (!genericSystem) {
      return invalidPreview([
        { code: "unsupported-ui-system", field: "system", message: "Dieses freie Montagesystem ist nicht verfügbar." },
      ]);
    }
    return {
      valid: true,
      errors: [],
      warnings,
      blocks,
      modules,
      blockCount: placedBlocks.length,
      moduleCount: placedModules.length,
      quantity,
      derived: {
        kind: "generic",
        nominalTiltDeg: genericSystem.nominalTiltDeg,
        effectiveTiltDeg: genericSystem.nominalTiltDeg,
        pitchXM: blockDefinition.pitchM.x,
        pitchYM: blockDefinition.pitchM.y,
        blockDepthM:
          blockDefinition.derivedDimensionsM.projectedDepthM ?? 0,
        moduleGapXM: genericSystem.moduleGapX ?? 0,
        moduleGapYM:
          genericSystem.systemId === GENERIC_SOUTH_SYSTEM_ID
            ? genericSystem.moduleGapY ?? 0
            : genericSystem.interModuleGapM,
        blockGapXM: genericSystem.blockGapX,
        blockGapYM: genericSystem.blockGapY,
      },
    };
  }

  if (!k2DerivedDimensions) {
    return invalidPreview([
      { code: "missing-k2-derived-geometry", field: "system", message: "Die K2 Geometrie konnte nicht abgeleitet werden." },
    ]);
  }
  const derivedDimensions = k2DerivedDimensions;
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
  if (isDDome && placedBlocks.length) {
    const limits = evaluateK2DDomeBlockLimits({
      moduleWidthM: moduleSpec.widthM,
      moduleLengthM: moduleSpec.heightM,
      rowSpaceM: system.rowSpaceM,
      quantityRows: new Set(placedBlocks.map((block) => block.rowIndex)).size,
      numberOfColumns: new Set(placedBlocks.map((block) => block.columnIndex)).size,
    });
    warnings.push(...limits.warnings);
  }

  return {
    valid: true,
    errors: [],
    warnings,
    blocks,
    modules,
    blockCount: placedBlocks.length,
    moduleCount: placedModules.length,
    quantity,
    derived: {
      kind: "k2",
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
      : system.systemId === GENERIC_SOUTH_SYSTEM_ID
        ? {
            systemId: GENERIC_SOUTH_SYSTEM_ID,
            adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
          } as const
        : system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
          ? {
              systemId: GENERIC_EAST_WEST_SYSTEM_ID,
              adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
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
