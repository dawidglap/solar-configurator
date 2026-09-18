import {
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
  type SurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import { resolveCompanyThermalFieldLimits, type CompanyPlannerDefaultsV1 } from "@/lib/planning/companyPlannerDefaults";
import type { ModulesConfig, PanelInstance, PanelSpec, Pt, RoofArea } from "@/types/planner";
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
} from "../advanced/advancedPlanningApplication";
import { withEffectiveAdvancedThermalLimits } from "../advanced/advancedThermalDefaults";
import { resolveStandardAutoLayoutCanvasAngle } from "../legacyStandardApplicationPolicy";
import { normalizeDegrees } from "./directLayoutGeometry";

type ObstacleZone = { roofId: string; id?: string; type?: unknown; points: Pt[] };
type SnowGuard = { roofId: string; id?: string; p1: Pt; p2: Pt };

function panelFootprint(panel: PanelInstance): Pt[] {
  const radians = panel.angleDeg * Math.PI / 180;
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

export type WholeLayoutReflowResult = {
  panels: PanelInstance[];
  surfacePlanning: SurfacePlanningV1;
  modules?: ModulesConfig;
  workingOrientationDeg: number;
};

function withoutGeneratedFingerprint<T extends SurfacePlanningV1>(config: T): T {
  const result = { ...config };
  delete result.generatedLayoutFingerprint;
  return result;
}

export function resolveAdvancedWorkingOrientationDeg(config: AdvancedSurfacePlanningV1): number {
  const system = config.advanced.system;
  return normalizeDegrees(
    "faceAzimuthDeg" in system
      ? system.faceAzimuthDeg
      : system.primaryFaceAzimuthDeg,
  );
}

export function rotateAdvancedWorkingOrientation(
  config: AdvancedSurfacePlanningV1,
  deltaDeg: number,
): AdvancedSurfacePlanningV1 {
  const system = config.advanced.system;
  const rotatedSystem = "faceAzimuthDeg" in system
    ? { ...system, faceAzimuthDeg: normalizeDegrees(system.faceAzimuthDeg + deltaDeg) }
    : { ...system, primaryFaceAzimuthDeg: normalizeDegrees(system.primaryFaceAzimuthDeg + deltaDeg) };
  return withoutGeneratedFingerprint({
    ...config,
    advanced: { ...config.advanced, system: rotatedSystem },
  } as AdvancedSurfacePlanningV1);
}

export function buildWholeLayoutReflow(input: {
  roof: RoofArea;
  currentPanels: readonly PanelInstance[];
  catalogPanels: readonly PanelSpec[];
  selectedPanelId: string;
  modules: ModulesConfig;
  companyPlannerDefaults: CompanyPlannerDefaultsV1;
  mppImage: number;
  zones: readonly ObstacleZone[];
  snowGuards: readonly SnowGuard[];
  deltaDeg: number;
  createPanelId: (index: number) => string;
  layoutRunId: string;
}): WholeLayoutReflowResult | null {
  const resolved = resolveSurfacePlanning(input.roof.surfacePlanning);
  const roofPanels = input.currentPanels.filter((panel) => panel.roofId === input.roof.id);
  const lockedBlockKeys = new Set(roofPanels
    .filter((panel) => panel.locked && panel.advanced?.blockKey)
    .map((panel) => panel.advanced?.blockKey));
  const protectedPanels = roofPanels.filter((panel) =>
    panel.locked || (panel.advanced?.blockKey && lockedBlockKeys.has(panel.advanced.blockKey)),
  );
  const effectiveZones = [
    ...input.zones,
    ...protectedPanels.map((panel) => ({
      id: `locked:${panel.id}`,
      roofId: input.roof.id,
      type: "riservata",
      points: panelFootprint(panel),
    })),
  ];

  if (resolved.status === "supported-standard" || resolved.status === "legacy-standard") {
    const config = resolved.status === "supported-standard" ? resolved.config : undefined;
    const currentPanel = roofPanels.find((panel) => !panel.locked) ?? roofPanels[0];
    const panelId = currentPanel?.panelId ?? input.selectedPanelId;
    const panel = input.catalogPanels.find((candidate) => candidate.id === panelId);
    if (!panel) return null;
    const orientation = config?.moduleLayoutMode ?? currentPanel?.orientation ?? input.modules.orientation;
    const currentAngle = currentPanel?.angleDeg ?? resolveStandardAutoLayoutCanvasAngle({
      roofId: input.roof.id,
      roofPolygon: input.roof.points,
      legacyRoofAzimuthDeg: input.roof.azimuthDeg,
      gridAngleDeg: input.modules.gridAngleDeg,
      perRoofAngles: input.modules.perRoofAngles,
      referenceEdgeIndex: input.roof.referenceEdgeIndex,
    });
    const targetAngle = normalizeDegrees(currentAngle + input.deltaDeg);
    const modules: ModulesConfig = {
      ...input.modules,
      ...(config?.moduleSpacing ? {
        spacingM: config.moduleSpacing.horizontalM,
        spacingXM: config.moduleSpacing.horizontalM,
        spacingYM: config.moduleSpacing.verticalM,
      } : {}),
      orientation,
      perRoofAngles: {
        ...(input.modules.perRoofAngles ?? {}),
        [input.roof.id]: targetAngle,
      },
    };
    const companyLimits = resolveCompanyThermalFieldLimits({
      company: input.companyPlannerDefaults,
      roofKind: "pitched",
    });
    const generated = buildDirectStandardRoofLayout({
      roof: input.roof,
      panel,
      modules,
      orientation,
      moduleTilt: config?.moduleTilt ?? { mode: "inherit-roof" },
      mppImage: input.mppImage,
      zones: effectiveZones,
      snowGuards: input.snowGuards,
      thermalFieldLimits: config?.thermalFieldLimits ?? (companyLimits.kind === "pitched-grid" ? companyLimits : undefined),
      createPanelId: input.createPanelId,
      alignmentMode: "current",
    });
    if (!generated?.panels.length) return null;
    return {
      panels: [...protectedPanels, ...generated.panels],
      surfacePlanning: withoutGeneratedFingerprint(generated.config),
      modules: generated.modules,
      workingOrientationDeg: targetAngle,
    };
  }

  if (resolved.status !== "supported-advanced") return null;
  const rotated = rotateAdvancedWorkingOrientation(
    withEffectiveAdvancedThermalLimits(resolved.config, input.companyPlannerDefaults),
    input.deltaDeg,
  );
  const generated = buildDirectAdvancedRoofLayout({
    roof: input.roof,
    config: rotated,
    mppImage: input.mppImage,
    zones: effectiveZones,
    snowGuards: [...input.snowGuards],
    layoutRunId: input.layoutRunId,
    createPanelId: input.createPanelId,
  });
  if (!generated?.panels.length) return null;
  return {
    panels: [...protectedPanels, ...generated.panels],
    surfacePlanning: withoutGeneratedFingerprint(generated.config),
    workingOrientationDeg: resolveAdvancedWorkingOrientationDeg(rotated),
  };
}
