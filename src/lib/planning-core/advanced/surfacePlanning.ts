import {
  GEOMETRY_V2_ENGINE_VERSION,
  type GridAnchor,
} from "../geometry-v2/types";
import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
} from "./k2-d-dome/constants";
import {
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
} from "./k2-s-dome/constants";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  type ModuleOrientation,
} from "./types";
import { GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M } from "./greenRoof";

export const SURFACE_PLANNING_SCHEMA_VERSION = 1 as const;
export const ADVANCED_INPUT_SCHEMA_VERSION = 1 as const;
export const MAX_FIXED_BLOCKS_PER_AXIS = 100;

export type SurfaceKind = "pitched" | "flat" | "green";

export type SurfacePhysicalProperties = {
  kind: SurfaceKind;
  /** Physical roof inclination, independent of PV module tilt. */
  slopeDeg?: number;
  /** Geographic azimuth (0=N, 90=E, 180=S, 270=W) of roof fall. */
  fallAzimuthDeg?: number;
};

export type AdvancedModuleSnapshot = {
  panelSpecId?: string;
  /** Physical short side, sufficient for deterministic recomputation. */
  widthM: number;
  /** Physical long side, sufficient for deterministic recomputation. */
  heightM: number;
  orientation: ModuleOrientation;
  powerW?: number;
};

export type AdvancedLayoutInputs = {
  marginM: number;
  phaseX: number;
  phaseY: number;
  anchorX: GridAnchor;
  anchorY: GridAnchor;
  /** Missing/auto preserves the historical Advanced auto-fill behaviour. */
  quantityMode?: "auto" | "fixed";
  /** Authoritative fixed-grid column count; derived totals are never persisted. */
  blocksPerRow?: number;
  /** Authoritative fixed-grid row count; derived totals are never persisted. */
  rowCount?: number;
};

export type GenericSouthSystemInputs = {
  systemId: typeof GENERIC_SOUTH_SYSTEM_ID;
  adapterVersion: typeof GENERIC_MOUNTING_ADAPTER_VERSION;
  nominalTiltDeg: number;
  faceAzimuthDeg: number;
  /** Module-to-module spacing before any additional block spacing. */
  moduleGapX?: number;
  moduleGapY?: number;
  blockGapX: number;
  blockGapY: number;
};

export type GenericEastWestSystemInputs = {
  systemId: typeof GENERIC_EAST_WEST_SYSTEM_ID;
  adapterVersion: typeof GENERIC_MOUNTING_ADAPTER_VERSION;
  nominalTiltDeg: number;
  primaryFaceAzimuthDeg: number;
  interModuleGapM: number;
  /** Cross-axis module spacing before any additional block spacing. */
  moduleGapX?: number;
  blockGapX: number;
  blockGapY: number;
};

export type K2SDomeSystemInputs = {
  systemId: typeof K2_S_DOME_SYSTEM_ID;
  adapterVersion: typeof K2_S_DOME_ADAPTER_VERSION;
  rowSpaceM: number;
  faceAzimuthDeg: number;
};

export type K2DDomeSystemInputs = {
  systemId: typeof K2_D_DOME_SYSTEM_ID;
  adapterVersion: typeof K2_D_DOME_ADAPTER_VERSION;
  rowSpaceM: number;
  primaryFaceAzimuthDeg: number;
};

export type AdvancedSystemInputs =
  | GenericSouthSystemInputs
  | GenericEastWestSystemInputs
  | K2SDomeSystemInputs
  | K2DDomeSystemInputs;

export type AdvancedPlanningInputsV1 = {
  inputSchemaVersion: typeof ADVANCED_INPUT_SCHEMA_VERSION;
  advancedEngineVersion: typeof ADVANCED_BLOCK_ENGINE_VERSION;
  geometryEngineVersion: typeof GEOMETRY_V2_ENGINE_VERSION;
  /** Height of the mounting-system underside; vertical metadata, not plan footprint. */
  undersideClearanceM?: number;
  module: AdvancedModuleSnapshot;
  system: AdvancedSystemInputs;
  layout: AdvancedLayoutInputs;
};

export type StandardModuleTiltInput =
  | { mode: "inherit-roof" }
  | { mode: "custom"; customTiltDeg: number };

export type StandardPanelMetadata = {
  layoutMode: "standard";
  moduleTiltMode: StandardModuleTiltInput["mode"];
  /** Applied physical module inclination; it does not alter legacy-v1 plan geometry. */
  effectiveTiltDeg: number;
};

export type StandardSurfacePlanningV1 = {
  schemaVersion: typeof SURFACE_PLANNING_SCHEMA_VERSION;
  mode: "standard";
  surface: SurfacePhysicalProperties;
  /** Missing on legacy documents and resolves to inherit-roof without migration. */
  moduleTilt?: StandardModuleTiltInput;
};

export type AdvancedSurfacePlanningV1 = {
  schemaVersion: typeof SURFACE_PLANNING_SCHEMA_VERSION;
  mode: "advanced";
  surface: SurfacePhysicalProperties;
  advanced: AdvancedPlanningInputsV1;
};

export type SurfacePlanningV1 =
  | StandardSurfacePlanningV1
  | AdvancedSurfacePlanningV1;

/**
 * The raw branch deliberately preserves documents written by a future SOLA
 * version. Consumers must call resolveSurfacePlanning before using the data.
 */
export type SurfacePlanningDocument =
  | SurfacePlanningV1
  | Record<string, unknown>;

type AdvancedPanelSystemIdentity =
  | {
      systemId: typeof GENERIC_SOUTH_SYSTEM_ID | typeof GENERIC_EAST_WEST_SYSTEM_ID;
      adapterVersion: typeof GENERIC_MOUNTING_ADAPTER_VERSION;
    }
  | {
      systemId: typeof K2_S_DOME_SYSTEM_ID;
      adapterVersion: typeof K2_S_DOME_ADAPTER_VERSION;
    }
  | {
      systemId: typeof K2_D_DOME_SYSTEM_ID;
      adapterVersion: typeof K2_D_DOME_ADAPTER_VERSION;
    };

export type AdvancedPanelMetadata = AdvancedPanelSystemIdentity & {
  layoutMode: "advanced";
  advancedEngineVersion: typeof ADVANCED_BLOCK_ENGINE_VERSION;
  geometryEngineVersion: typeof GEOMETRY_V2_ENGINE_VERSION;
  blockKey: string;
  /** Deterministic K2 continuous-field identity; absent on legacy materializations. */
  montageFieldKey?: string;
  slotIndex: number;
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  moduleFaceAzimuthDeg: number;
  layoutRunId?: string;
};

export type SurfacePlanningIssue = {
  path: string;
  code: string;
  message: string;
};

export type SurfacePlanningResolution =
  | {
      status: "legacy-standard";
      effectiveMode: "standard";
      config: undefined;
      issues: [];
    }
  | {
      status: "supported-standard";
      effectiveMode: "standard";
      config: StandardSurfacePlanningV1;
      issues: [];
    }
  | {
      status: "supported-advanced";
      effectiveMode: "advanced";
      config: AdvancedSurfacePlanningV1;
      issues: [];
    }
  | {
      status: "invalid-advanced";
      effectiveMode: "advanced";
      raw: unknown;
      issues: SurfacePlanningIssue[];
    }
  | {
      status: "unsupported-advanced";
      effectiveMode: "advanced";
      raw: unknown;
      issues: SurfacePlanningIssue[];
    }
  | {
      status: "invalid-document";
      effectiveMode: undefined;
      raw: unknown;
      issues: SurfacePlanningIssue[];
    };

type RoofWithSurfacePlanning = {
  id: string;
  surfacePlanning?: SurfacePlanningDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

function issue(path: string, code: string, message: string): SurfacePlanningIssue {
  return { path, code, message };
}

function readSurface(
  value: unknown,
  issues: SurfacePlanningIssue[],
): SurfacePhysicalProperties | null {
  if (!isRecord(value)) {
    issues.push(issue("surface", "invalid-surface", "Surface properties are required."));
    return null;
  }
  if (!(["pitched", "flat", "green"] as unknown[]).includes(value.kind)) {
    issues.push(issue("surface.kind", "invalid-surface-kind", "Unsupported surface kind."));
    return null;
  }
  if (value.slopeDeg !== undefined && (!finite(value.slopeDeg) || value.slopeDeg < 0 || value.slopeDeg > 90)) {
    issues.push(issue("surface.slopeDeg", "invalid-slope", "Slope must be between 0 and 90 degrees."));
  }
  if (value.fallAzimuthDeg !== undefined && !finite(value.fallAzimuthDeg)) {
    issues.push(issue("surface.fallAzimuthDeg", "invalid-azimuth", "Fall azimuth must be finite."));
  }
  if (issues.length > 0) return null;
  return {
    kind: value.kind as SurfaceKind,
    ...(value.slopeDeg !== undefined ? { slopeDeg: value.slopeDeg as number } : {}),
    ...(value.fallAzimuthDeg !== undefined
      ? { fallAzimuthDeg: normalizeAzimuth(value.fallAzimuthDeg as number) }
      : {}),
  };
}

function readStandardModuleTilt(
  value: unknown,
  issues: SurfacePlanningIssue[],
): StandardModuleTiltInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(issue("moduleTilt", "invalid-module-tilt", "Module tilt must be an object."));
    return undefined;
  }
  if (value.mode === "inherit-roof") return { mode: "inherit-roof" };
  if (value.mode === "custom") {
    if (!finite(value.customTiltDeg) || value.customTiltDeg < 0 || value.customTiltDeg > 90) {
      issues.push(issue("moduleTilt.customTiltDeg", "invalid-module-tilt", "Custom module tilt must be between 0 and 90 degrees."));
      return undefined;
    }
    return { mode: "custom", customTiltDeg: value.customTiltDeg };
  }
  issues.push(issue("moduleTilt.mode", "invalid-module-tilt-mode", "Module tilt mode is invalid."));
  return undefined;
}

export function resolveStandardModuleTilt(input: {
  moduleTilt?: StandardModuleTiltInput;
  roofSlopeDeg?: number;
}): { mode: StandardModuleTiltInput["mode"]; effectiveTiltDeg?: number } {
  if (input.moduleTilt?.mode === "custom") {
    return { mode: "custom", effectiveTiltDeg: input.moduleTilt.customTiltDeg };
  }
  return {
    mode: "inherit-roof",
    ...(finite(input.roofSlopeDeg) && input.roofSlopeDeg >= 0 && input.roofSlopeDeg <= 90
      ? { effectiveTiltDeg: input.roofSlopeDeg }
      : {}),
  };
}

function readModule(
  value: unknown,
  issues: SurfacePlanningIssue[],
): AdvancedModuleSnapshot | null {
  if (!isRecord(value)) {
    issues.push(issue("advanced.module", "invalid-module", "A module geometry snapshot is required."));
    return null;
  }
  if (!positive(value.widthM)) {
    issues.push(issue("advanced.module.widthM", "invalid-module-width", "Module width must be positive."));
  }
  if (!positive(value.heightM)) {
    issues.push(issue("advanced.module.heightM", "invalid-module-height", "Module height must be positive."));
  }
  if (value.orientation !== "portrait" && value.orientation !== "landscape") {
    issues.push(issue("advanced.module.orientation", "invalid-orientation", "Module orientation is invalid."));
  }
  if (value.panelSpecId !== undefined && typeof value.panelSpecId !== "string") {
    issues.push(issue("advanced.module.panelSpecId", "invalid-panel-spec-id", "Panel spec ID must be a string."));
  }
  if (value.powerW !== undefined && !positive(value.powerW)) {
    issues.push(issue("advanced.module.powerW", "invalid-module-power", "Module power must be positive."));
  }
  if (issues.length > 0) return null;
  return {
    ...(typeof value.panelSpecId === "string" ? { panelSpecId: value.panelSpecId } : {}),
    widthM: value.widthM as number,
    heightM: value.heightM as number,
    orientation: value.orientation as ModuleOrientation,
    ...(value.powerW !== undefined ? { powerW: value.powerW as number } : {}),
  };
}

function readLayout(
  value: unknown,
  issues: SurfacePlanningIssue[],
): AdvancedLayoutInputs | null {
  if (!isRecord(value)) {
    issues.push(issue("advanced.layout", "invalid-layout", "Advanced layout inputs are required."));
    return null;
  }
  if (!nonNegative(value.marginM)) {
    issues.push(issue("advanced.layout.marginM", "invalid-margin", "Margin must be non-negative."));
  }
  for (const key of ["phaseX", "phaseY"] as const) {
    if (!finite(value[key]) || value[key] < 0 || value[key] >= 1) {
      issues.push(issue(`advanced.layout.${key}`, "invalid-phase", `${key} must be in [0, 1).`));
    }
  }
  for (const key of ["anchorX", "anchorY"] as const) {
    if (value[key] !== "start" && value[key] !== "center" && value[key] !== "end") {
      issues.push(issue(`advanced.layout.${key}`, "invalid-anchor", `${key} is invalid.`));
    }
  }
  const quantityMode = value.quantityMode ?? "auto";
  if (quantityMode !== "auto" && quantityMode !== "fixed") {
    issues.push(issue("advanced.layout.quantityMode", "invalid-quantity-mode", "Quantity mode is invalid."));
  }
  if (quantityMode === "fixed") {
    for (const key of ["blocksPerRow", "rowCount"] as const) {
      if (!Number.isInteger(value[key]) || (value[key] as number) <= 0) {
        issues.push(issue(`advanced.layout.${key}`, "invalid-fixed-quantity", `${key} must be a positive integer.`));
      } else if ((value[key] as number) > MAX_FIXED_BLOCKS_PER_AXIS) {
        issues.push(issue(`advanced.layout.${key}`, "fixed-quantity-too-large", `${key} exceeds the technical limit.`));
      }
    }
  }
  if (issues.length > 0) return null;
  return {
    marginM: value.marginM as number,
    phaseX: value.phaseX as number,
    phaseY: value.phaseY as number,
    anchorX: value.anchorX as GridAnchor,
    anchorY: value.anchorY as GridAnchor,
    ...(quantityMode === "fixed"
      ? {
          quantityMode: "fixed" as const,
          blocksPerRow: value.blocksPerRow as number,
          rowCount: value.rowCount as number,
        }
      : value.quantityMode === "auto"
        ? { quantityMode: "auto" as const }
        : {}),
  };
}

function readSystem(
  value: unknown,
): { status: "valid"; system: AdvancedSystemInputs } | { status: "invalid" | "unsupported"; issues: SurfacePlanningIssue[] } {
  if (!isRecord(value) || typeof value.systemId !== "string") {
    return {
      status: "invalid",
      issues: [issue("advanced.system", "invalid-system", "Advanced system identity is required.")],
    };
  }

  const unsupportedVersion = (expected: string) => ({
    status: "unsupported" as const,
    issues: [issue("advanced.system.adapterVersion", "unsupported-adapter-version", `Expected ${expected}.`)],
  });
  const invalid: SurfacePlanningIssue[] = [];
  const requireNumber = (key: string, options: { nonNegative?: boolean; positive?: boolean } = {}) => {
    const current = value[key];
    const valid = options.positive ? positive(current) : options.nonNegative ? nonNegative(current) : finite(current);
    if (!valid) invalid.push(issue(`advanced.system.${key}`, "invalid-system-input", `${key} is invalid.`));
    return current as number;
  };
  const optionalNonNegativeNumber = (key: string): number | undefined => {
    if (value[key] === undefined) return undefined;
    return requireNumber(key, { nonNegative: true });
  };

  switch (value.systemId) {
    case GENERIC_SOUTH_SYSTEM_ID: {
      if (value.adapterVersion !== GENERIC_MOUNTING_ADAPTER_VERSION) return unsupportedVersion(GENERIC_MOUNTING_ADAPTER_VERSION);
      const nominalTiltDeg = requireNumber("nominalTiltDeg", { nonNegative: true });
      const faceAzimuthDeg = requireNumber("faceAzimuthDeg");
      const moduleGapX = optionalNonNegativeNumber("moduleGapX");
      const moduleGapY = optionalNonNegativeNumber("moduleGapY");
      const blockGapX = requireNumber("blockGapX", { nonNegative: true });
      const blockGapY = requireNumber("blockGapY", { nonNegative: true });
      if (nominalTiltDeg > 90) invalid.push(issue("advanced.system.nominalTiltDeg", "invalid-tilt", "Tilt must not exceed 90 degrees."));
      if (invalid.length) return { status: "invalid", issues: invalid };
      return { status: "valid", system: { systemId: value.systemId, adapterVersion: value.adapterVersion, nominalTiltDeg, faceAzimuthDeg: normalizeAzimuth(faceAzimuthDeg), ...(moduleGapX !== undefined ? { moduleGapX } : {}), ...(moduleGapY !== undefined ? { moduleGapY } : {}), blockGapX, blockGapY } };
    }
    case GENERIC_EAST_WEST_SYSTEM_ID: {
      if (value.adapterVersion !== GENERIC_MOUNTING_ADAPTER_VERSION) return unsupportedVersion(GENERIC_MOUNTING_ADAPTER_VERSION);
      const nominalTiltDeg = requireNumber("nominalTiltDeg", { nonNegative: true });
      const primaryFaceAzimuthDeg = requireNumber("primaryFaceAzimuthDeg");
      const interModuleGapM = requireNumber("interModuleGapM", { nonNegative: true });
      const moduleGapX = optionalNonNegativeNumber("moduleGapX");
      const blockGapX = requireNumber("blockGapX", { nonNegative: true });
      const blockGapY = requireNumber("blockGapY", { nonNegative: true });
      if (nominalTiltDeg > 90) invalid.push(issue("advanced.system.nominalTiltDeg", "invalid-tilt", "Tilt must not exceed 90 degrees."));
      if (invalid.length) return { status: "invalid", issues: invalid };
      return { status: "valid", system: { systemId: value.systemId, adapterVersion: value.adapterVersion, nominalTiltDeg, primaryFaceAzimuthDeg: normalizeAzimuth(primaryFaceAzimuthDeg), interModuleGapM, ...(moduleGapX !== undefined ? { moduleGapX } : {}), blockGapX, blockGapY } };
    }
    case K2_S_DOME_SYSTEM_ID: {
      if (value.adapterVersion !== K2_S_DOME_ADAPTER_VERSION) return unsupportedVersion(K2_S_DOME_ADAPTER_VERSION);
      const rowSpaceM = requireNumber("rowSpaceM", { positive: true });
      const faceAzimuthDeg = requireNumber("faceAzimuthDeg");
      if (invalid.length) return { status: "invalid", issues: invalid };
      return { status: "valid", system: { systemId: value.systemId, adapterVersion: value.adapterVersion, rowSpaceM, faceAzimuthDeg: normalizeAzimuth(faceAzimuthDeg) } };
    }
    case K2_D_DOME_SYSTEM_ID: {
      if (value.adapterVersion !== K2_D_DOME_ADAPTER_VERSION) return unsupportedVersion(K2_D_DOME_ADAPTER_VERSION);
      const rowSpaceM = requireNumber("rowSpaceM", { positive: true });
      const primaryFaceAzimuthDeg = requireNumber("primaryFaceAzimuthDeg");
      if (invalid.length) return { status: "invalid", issues: invalid };
      return { status: "valid", system: { systemId: value.systemId, adapterVersion: value.adapterVersion, rowSpaceM, primaryFaceAzimuthDeg: normalizeAzimuth(primaryFaceAzimuthDeg) } };
    }
    default:
      return {
        status: "unsupported",
        issues: [issue("advanced.system.systemId", "unsupported-system", `System ${value.systemId} is not supported by this SOLA version.`)],
      };
  }
}

export function resolveSurfacePlanning(value: unknown): SurfacePlanningResolution {
  if (value === undefined) {
    return { status: "legacy-standard", effectiveMode: "standard", config: undefined, issues: [] };
  }
  if (!isRecord(value)) {
    return { status: "invalid-document", effectiveMode: undefined, raw: value, issues: [issue("surfacePlanning", "invalid-document", "Surface planning must be an object.")] };
  }
  if (value.mode !== "standard" && value.mode !== "advanced") {
    return { status: "invalid-document", effectiveMode: undefined, raw: value, issues: [issue("surfacePlanning.mode", "invalid-mode", "Surface planning mode is missing or invalid.")] };
  }

  const advancedMode = value.mode === "advanced";
  if (value.schemaVersion !== SURFACE_PLANNING_SCHEMA_VERSION) {
    const result = { raw: value, issues: [issue("surfacePlanning.schemaVersion", "unsupported-schema-version", "Surface planning schema version is unsupported.")] };
    return advancedMode
      ? { status: "unsupported-advanced", effectiveMode: "advanced", ...result }
      : { status: "invalid-document", effectiveMode: undefined, ...result };
  }

  const surfaceIssues: SurfacePlanningIssue[] = [];
  const surface = readSurface(value.surface, surfaceIssues);
  if (!surface) {
    return advancedMode
      ? { status: "invalid-advanced", effectiveMode: "advanced", raw: value, issues: surfaceIssues }
      : { status: "invalid-document", effectiveMode: undefined, raw: value, issues: surfaceIssues };
  }
  if (!advancedMode) {
    const moduleTiltIssues: SurfacePlanningIssue[] = [];
    const moduleTilt = readStandardModuleTilt(value.moduleTilt, moduleTiltIssues);
    if (moduleTiltIssues.length) {
      return { status: "invalid-document", effectiveMode: undefined, raw: value, issues: moduleTiltIssues };
    }
    return {
      status: "supported-standard",
      effectiveMode: "standard",
      config: {
        schemaVersion: 1,
        mode: "standard",
        surface,
        ...(moduleTilt ? { moduleTilt } : {}),
      },
      issues: [],
    };
  }

  if (!isRecord(value.advanced)) {
    return { status: "invalid-advanced", effectiveMode: "advanced", raw: value, issues: [issue("advanced", "invalid-advanced-input", "Advanced inputs are required.")] };
  }
  if (value.advanced.inputSchemaVersion !== ADVANCED_INPUT_SCHEMA_VERSION ||
      value.advanced.advancedEngineVersion !== ADVANCED_BLOCK_ENGINE_VERSION ||
      value.advanced.geometryEngineVersion !== GEOMETRY_V2_ENGINE_VERSION) {
    return {
      status: "unsupported-advanced",
      effectiveMode: "advanced",
      raw: value,
      issues: [issue("advanced", "unsupported-engine-version", "Advanced input or engine version is unsupported.")],
    };
  }

  const systemResult = readSystem(value.advanced.system);
  if (systemResult.status === "unsupported") {
    return { status: "unsupported-advanced", effectiveMode: "advanced", raw: value, issues: systemResult.issues };
  }
  const advancedIssues: SurfacePlanningIssue[] = [];
  const undersideClearanceM = value.advanced.undersideClearanceM;
  if (
    undersideClearanceM !== undefined &&
    (!finite(undersideClearanceM) ||
      undersideClearanceM < GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.min ||
      undersideClearanceM > GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.max)
  ) {
    advancedIssues.push(
      issue(
        "advanced.undersideClearanceM",
        "invalid-underside-clearance",
        "Underside clearance is outside the supported technical range.",
      ),
    );
  }
  const moduleSnapshot = readModule(value.advanced.module, advancedIssues);
  const layout = readLayout(value.advanced.layout, advancedIssues);
  if (systemResult.status === "invalid") advancedIssues.push(...systemResult.issues);
  if (!moduleSnapshot || !layout || systemResult.status !== "valid") {
    return { status: "invalid-advanced", effectiveMode: "advanced", raw: value, issues: advancedIssues };
  }

  return {
    status: "supported-advanced",
    effectiveMode: "advanced",
    config: {
      schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
      mode: "advanced",
      surface,
      advanced: {
        inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
        advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
        geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
        ...(undersideClearanceM !== undefined
          ? { undersideClearanceM: undersideClearanceM as number }
          : {}),
        module: moduleSnapshot,
        system: systemResult.system,
        layout,
      },
    },
    issues: [],
  };
}

export function getRoofSurfacePlanning<T extends RoofWithSurfacePlanning>(
  roofs: readonly T[],
  roofId: string,
): SurfacePlanningResolution {
  return resolveSurfacePlanning(roofs.find((roof) => roof.id === roofId)?.surfacePlanning);
}

export function setCommittedSurfacePlanningOnRoofs<T extends RoofWithSurfacePlanning>(
  roofs: readonly T[],
  roofId: string,
  config: SurfacePlanningV1,
): T[] {
  const resolved = resolveSurfacePlanning(config);
  if (resolved.status !== "supported-standard" && resolved.status !== "supported-advanced") {
    throw new TypeError("Committed surface planning must be supported and structurally valid.");
  }
  return roofs.map((roof) => roof.id === roofId ? { ...roof, surfacePlanning: resolved.config } : roof);
}

export function clearSurfacePlanningOnRoofs<T extends RoofWithSurfacePlanning>(
  roofs: readonly T[],
  roofId: string,
): T[] {
  return roofs.map((roof) => {
    if (roof.id !== roofId || roof.surfacePlanning === undefined) return roof;
    const withoutSurfacePlanning = { ...roof };
    delete withoutSurfacePlanning.surfacePlanning;
    return withoutSurfacePlanning;
  });
}
