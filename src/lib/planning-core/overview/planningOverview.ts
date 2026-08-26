import {
  analyzeRectangularRoof,
  polygonArea,
} from "../geometry-v2";
import {
  resolveSurfacePlanning,
  type SurfaceKind,
  type SurfacePlanningDocument,
} from "../advanced/surfacePlanning";
import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
} from "../advanced/types";
import {
  createK2SDomeBlock,
  K2_S_DOME_NOMINAL_TILT_DEG,
  K2_S_DOME_SYSTEM_ID,
} from "../advanced/k2-s-dome";
import {
  createK2DDomeBlock,
  K2_D_DOME_NOMINAL_TILT_DEG,
  K2_D_DOME_SYSTEM_ID,
} from "../advanced/k2-d-dome";

export type PlanningOverviewRoofInput = {
  id: string;
  name?: string;
  points: readonly { x: number; y: number }[];
  surfacePlanning?: SurfacePlanningDocument;
};

export type PlanningOverviewPanelInput = {
  roofId: string;
  panelId: string;
  advanced?: {
    blockKey?: string;
  };
};

export type PlanningOverviewCatalogModule = {
  id: string;
  brand?: string;
  model?: string;
  powerW?: number;
};

export type PlanningOverviewPower = {
  /** Available only when every committed panel has a known power. */
  kwp?: number;
  knownKwp: number;
  knownPanelCount: number;
  missingPanelCount: number;
  complete: boolean;
};

export type PlanningOverviewWarning = {
  code: string;
  message: string;
};

export type PlanningOverviewRoof = {
  id: string;
  index: number;
  displayName: string;
  surfaceKind: SurfaceKind;
  configurationStatus:
    | "legacy-standard"
    | "supported-standard"
    | "supported-advanced"
    | "invalid"
    | "unsupported";
  systemId?: string;
  mountingOrientation?: "south" | "east-west";
  orientationAzimuthDeg?: number[];
  nominalTiltDeg?: number;
  arrangement:
    | { mode: "standard" }
    | { mode: "auto" }
    | { mode: "fixed"; blocksPerRow: number; rowCount: number };
  moduleCount: number;
  blockCount?: number;
  power: PlanningOverviewPower;
  moduleLabel?: string;
  marginM?: number;
  rowSpaceM?: number;
  serviceCorridorM?: number;
  roofDimensions?: { lengthM: number; widthM: number };
  roofAreaM2?: number;
  hasUnappliedDraft: boolean;
  warnings: PlanningOverviewWarning[];
};

export type PlanningOverview = {
  roofCount: number;
  moduleCount: number;
  power: PlanningOverviewPower;
  warningRoofCount: number;
  roofs: PlanningOverviewRoof[];
};

export type BuildPlanningOverviewInput = {
  roofs: readonly PlanningOverviewRoofInput[];
  panels: readonly PlanningOverviewPanelInput[];
  catalogModules?: readonly PlanningOverviewCatalogModule[];
  mppImage?: number;
  dirtyRoofIds?: readonly string[];
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

function rawSurfaceKind(value: unknown): SurfaceKind | undefined {
  if (!value || typeof value !== "object") return undefined;
  const surface = (value as { surface?: unknown }).surface;
  if (!surface || typeof surface !== "object") return undefined;
  const kind = (surface as { kind?: unknown }).kind;
  return kind === "pitched" || kind === "flat" || kind === "green"
    ? kind
    : undefined;
}

function rawModulePowerW(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const advanced = (value as { advanced?: unknown }).advanced;
  if (!advanced || typeof advanced !== "object") return undefined;
  const moduleSnapshot = (advanced as { module?: unknown }).module;
  if (!moduleSnapshot || typeof moduleSnapshot !== "object") return undefined;
  const powerW = (moduleSnapshot as { powerW?: unknown }).powerW;
  return finitePositive(powerW) ? powerW : undefined;
}

function moduleLabel(catalogModule: PlanningOverviewCatalogModule): string | undefined {
  const label = [catalogModule.brand, catalogModule.model]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return label || undefined;
}

function powerSummary(input: {
  panels: readonly PlanningOverviewPanelInput[];
  roofModulePowerW?: number;
  catalogById: ReadonlyMap<string, PlanningOverviewCatalogModule>;
}): PlanningOverviewPower {
  let knownW = 0;
  let knownPanelCount = 0;
  for (const panel of input.panels) {
    const catalogPowerW = input.catalogById.get(panel.panelId)?.powerW;
    const powerW = input.roofModulePowerW ?? catalogPowerW;
    if (!finitePositive(powerW)) continue;
    knownW += powerW;
    knownPanelCount += 1;
  }
  const missingPanelCount = input.panels.length - knownPanelCount;
  const knownKwp = knownW / 1000;
  return {
    ...(missingPanelCount === 0 ? { kwp: knownKwp } : {}),
    knownKwp,
    knownPanelCount,
    missingPanelCount,
    complete: missingPanelCount === 0,
  };
}

function combinePower(summaries: readonly PlanningOverviewPower[]): PlanningOverviewPower {
  const knownKwp = summaries.reduce((sum, item) => sum + item.knownKwp, 0);
  const knownPanelCount = summaries.reduce(
    (sum, item) => sum + item.knownPanelCount,
    0,
  );
  const missingPanelCount = summaries.reduce(
    (sum, item) => sum + item.missingPanelCount,
    0,
  );
  return {
    ...(missingPanelCount === 0 ? { kwp: knownKwp } : {}),
    knownKwp,
    knownPanelCount,
    missingPanelCount,
    complete: missingPanelCount === 0,
  };
}

function deriveRoofDimensions(
  roof: PlanningOverviewRoofInput,
  mppImage: number | undefined,
): Pick<PlanningOverviewRoof, "roofDimensions" | "roofAreaM2"> {
  if (!finitePositive(mppImage) || roof.points.length < 3) return {};
  const rectangle = analyzeRectangularRoof(roof.points, mppImage);
  if (rectangle.supported) {
    return {
      roofDimensions: {
        lengthM: rectangle.dimensions.lengthM,
        widthM: rectangle.dimensions.widthM,
      },
    };
  }
  const areaM2 = polygonArea(roof.points.map((point) => ({ ...point }))) * mppImage * mppImage;
  return finitePositive(areaM2) ? { roofAreaM2: areaM2 } : {};
}

function uniqueBlockCount(
  panels: readonly PlanningOverviewPanelInput[],
): number | undefined {
  if (panels.length === 0) return 0;
  if (
    panels.some(
      (panel) =>
        typeof panel.advanced?.blockKey !== "string" ||
        panel.advanced.blockKey.length === 0,
    )
  ) {
    return undefined;
  }
  return new Set(panels.map((panel) => panel.advanced!.blockKey)).size;
}

function systemModuleCount(systemId: string): number | undefined {
  if (
    systemId === K2_D_DOME_SYSTEM_ID ||
    systemId === GENERIC_EAST_WEST_SYSTEM_ID
  ) {
    return 2;
  }
  if (
    systemId === K2_S_DOME_SYSTEM_ID ||
    systemId === GENERIC_SOUTH_SYSTEM_ID
  ) {
    return 1;
  }
  return undefined;
}

export function buildPlanningOverview(
  input: BuildPlanningOverviewInput,
): PlanningOverview {
  const catalogById = new Map(
    (input.catalogModules ?? []).map((module) => [module.id, module]),
  );
  const dirtyRoofIds = new Set(input.dirtyRoofIds ?? []);
  const roofs = input.roofs.map((roof, roofIndex): PlanningOverviewRoof => {
    const committedPanels = input.panels.filter(
      (panel) => panel.roofId === roof.id,
    );
    const resolution = resolveSurfacePlanning(roof.surfacePlanning);
    const warnings: PlanningOverviewWarning[] = [];
    let surfaceKind: SurfaceKind = "pitched";
    let configurationStatus: PlanningOverviewRoof["configurationStatus"] =
      "legacy-standard";
    let systemId: string | undefined;
    let mountingOrientation: PlanningOverviewRoof["mountingOrientation"];
    let orientationAzimuthDeg: number[] | undefined;
    let nominalTiltDeg: number | undefined;
    let arrangement: PlanningOverviewRoof["arrangement"] = {
      mode: "standard",
    };
    let blockCount: number | undefined;
    let marginM: number | undefined;
    let rowSpaceM: number | undefined;
    let serviceCorridorM: number | undefined;
    let roofModulePowerW: number | undefined;
    let configuredPanelSpecId: string | undefined;

    if (resolution.status === "supported-standard") {
      configurationStatus = "supported-standard";
      surfaceKind = resolution.config.surface.kind;
    } else if (resolution.status === "supported-advanced") {
      configurationStatus = "supported-advanced";
      const config = resolution.config;
      const advanced = config.advanced;
      const system = advanced.system;
      surfaceKind = config.surface.kind;
      systemId = system.systemId;
      marginM = advanced.layout.marginM;
      roofModulePowerW = advanced.module.powerW;
      configuredPanelSpecId = advanced.module.panelSpecId;
      blockCount = uniqueBlockCount(committedPanels);
      arrangement =
        advanced.layout.quantityMode === "fixed"
          ? {
              mode: "fixed",
              blocksPerRow: advanced.layout.blocksPerRow!,
              rowCount: advanced.layout.rowCount!,
            }
          : { mode: "auto" };

      if (system.systemId === K2_D_DOME_SYSTEM_ID) {
        mountingOrientation = "east-west";
        orientationAzimuthDeg = [
          system.primaryFaceAzimuthDeg,
          normalizeAzimuth(system.primaryFaceAzimuthDeg + 180),
        ];
        nominalTiltDeg = K2_D_DOME_NOMINAL_TILT_DEG;
        rowSpaceM = system.rowSpaceM;
        const adapter = createK2DDomeBlock({
          module: advanced.module,
          rowSpaceM: system.rowSpaceM,
          primaryFaceAzimuthDeg: system.primaryFaceAzimuthDeg,
        });
        if (adapter.valid) {
          serviceCorridorM = adapter.derivedDimensions.serviceCorridorM;
        } else {
          warnings.push(
            ...adapter.errors.map((error) => ({
              code: error.code,
              message: error.message,
            })),
          );
        }
      } else if (system.systemId === K2_S_DOME_SYSTEM_ID) {
        mountingOrientation = "south";
        orientationAzimuthDeg = [system.faceAzimuthDeg];
        nominalTiltDeg = K2_S_DOME_NOMINAL_TILT_DEG;
        rowSpaceM = system.rowSpaceM;
        const adapter = createK2SDomeBlock({
          module: advanced.module,
          rowSpaceM: system.rowSpaceM,
          faceAzimuthDeg: system.faceAzimuthDeg,
        });
        if (adapter.valid) {
          serviceCorridorM = adapter.derivedDimensions.serviceCorridorM;
        } else {
          warnings.push(
            ...adapter.errors.map((error) => ({
              code: error.code,
              message: error.message,
            })),
          );
        }
      } else if (system.systemId === GENERIC_EAST_WEST_SYSTEM_ID) {
        mountingOrientation = "east-west";
        orientationAzimuthDeg = [
          system.primaryFaceAzimuthDeg,
          normalizeAzimuth(system.primaryFaceAzimuthDeg + 180),
        ];
        nominalTiltDeg = system.nominalTiltDeg;
      } else if (system.systemId === GENERIC_SOUTH_SYSTEM_ID) {
        mountingOrientation = "south";
        orientationAzimuthDeg = [system.faceAzimuthDeg];
        nominalTiltDeg = system.nominalTiltDeg;
      }

      if (arrangement.mode === "fixed") {
        const modulesPerBlock = systemModuleCount(system.systemId);
        const expectedBlocks =
          arrangement.blocksPerRow * arrangement.rowCount;
        if (blockCount !== undefined && blockCount !== expectedBlocks) {
          warnings.push({
            code: "fixed-block-count-mismatch",
            message: `Gespeichert sind ${blockCount} von ${expectedBlocks} erwarteten K2 Blocks.`,
          });
        }
        if (
          modulesPerBlock !== undefined &&
          committedPanels.length !== expectedBlocks * modulesPerBlock
        ) {
          warnings.push({
            code: "fixed-module-count-mismatch",
            message: `Gespeichert sind ${committedPanels.length} von ${expectedBlocks * modulesPerBlock} erwarteten Modulen.`,
          });
        }
      }
    } else if (
      resolution.status === "unsupported-advanced" ||
      resolution.status === "invalid-advanced"
    ) {
      configurationStatus =
        resolution.status === "unsupported-advanced" ? "unsupported" : "invalid";
      surfaceKind = rawSurfaceKind(resolution.raw) ?? "flat";
      roofModulePowerW = rawModulePowerW(resolution.raw);
      blockCount = uniqueBlockCount(committedPanels);
      warnings.push(
        ...resolution.issues.map((current) => ({
          code: current.code,
          message: current.message,
        })),
      );
      arrangement = { mode: "auto" };
    } else if (resolution.status === "invalid-document") {
      configurationStatus = "invalid";
      surfaceKind = rawSurfaceKind(resolution.raw) ?? "pitched";
      warnings.push(
        ...resolution.issues.map((current) => ({
          code: current.code,
          message: current.message,
        })),
      );
    }

    const power = powerSummary({
      panels: committedPanels,
      roofModulePowerW,
      catalogById,
    });
    const catalogIds = new Set(
      [
        configuredPanelSpecId,
        ...committedPanels.map((panel) => panel.panelId),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const labels = [...catalogIds]
      .map((id) => catalogById.get(id))
      .filter(
        (module): module is PlanningOverviewCatalogModule => module !== undefined,
      )
      .map(moduleLabel)
      .filter((label): label is string => label !== undefined);

    return {
      id: roof.id,
      index: roofIndex + 1,
      displayName: roof.name?.trim() || `Dachfläche ${roofIndex + 1}`,
      surfaceKind,
      configurationStatus,
      ...(systemId ? { systemId } : {}),
      ...(mountingOrientation ? { mountingOrientation } : {}),
      ...(orientationAzimuthDeg ? { orientationAzimuthDeg } : {}),
      ...(nominalTiltDeg !== undefined ? { nominalTiltDeg } : {}),
      arrangement,
      moduleCount: committedPanels.length,
      ...(blockCount !== undefined ? { blockCount } : {}),
      power,
      ...(labels.length === 1
        ? { moduleLabel: labels[0] }
        : labels.length > 1
          ? { moduleLabel: "Mehrere Modultypen" }
          : {}),
      ...(marginM !== undefined ? { marginM } : {}),
      ...(rowSpaceM !== undefined ? { rowSpaceM } : {}),
      ...(serviceCorridorM !== undefined ? { serviceCorridorM } : {}),
      ...deriveRoofDimensions(roof, input.mppImage),
      hasUnappliedDraft: dirtyRoofIds.has(roof.id),
      warnings,
    };
  });
  const power = combinePower(roofs.map((roof) => roof.power));
  return {
    roofCount: roofs.length,
    moduleCount: roofs.reduce((sum, roof) => sum + roof.moduleCount, 0),
    power,
    warningRoofCount: roofs.filter((roof) => roof.warnings.length > 0).length,
    roofs,
  };
}
