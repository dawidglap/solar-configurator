"use client";

import React from "react";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type ThermalFieldLimits,
} from "@/lib/planning-core/advanced";
import { resolveMaximumWholeUnits } from "@/lib/planning-core/geometry-v2";
import {
  isValidThermalFieldLimitM,
  resolveCompanyThermalFieldLimits,
} from "@/lib/planning/companyPlannerDefaults";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import {
  computeAdvancedPlanningPreview,
  createStandardPlanningDraft,
  getAdvancedRowSpaceM,
  resolveStandardTiltInput,
} from "../advanced/advancedPlanningApplication";
import { withEffectiveAdvancedThermalLimits } from "../advanced/advancedThermalDefaults";
import { resolveStandardAutoLayoutSpacingAxes } from "../legacyStandardApplicationPolicy";

const inputClass = "glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40";

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9);
}

function sameLimits(a: ThermalFieldLimits, b: ThermalFieldLimits): boolean {
  if (a.kind !== b.kind) return false;
  if (!sameNumber(a.thermalSeparationGapM, b.thermalSeparationGapM)) return false;
  return a.kind === "pitched-grid" && b.kind === "pitched-grid"
    ? sameNumber(a.maxRowDirectionM, b.maxRowDirectionM) &&
        sameNumber(a.maxColumnDirectionM, b.maxColumnDirectionM)
    : a.kind === "flat-block" && b.kind === "flat-block" &&
        sameNumber(a.maxRailDirectionM, b.maxRailDirectionM) &&
        sameNumber(a.maxModuleLongSideDirectionM, b.maxModuleLongSideDirectionM);
}

export default function ThermalFieldLimitsControl() {
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const roof = usePlannerV2Store((state) => state.layers.find((item) => item.id === state.selectedId));
  const draft = usePlannerV2Store((state) => state.selectedId ? state.roofPlanningDrafts[state.selectedId] : undefined);
  const modules = usePlannerV2Store((state) => state.modules);
  const selectedPanelId = usePlannerV2Store((state) => state.selectedPanelId);
  const catalogPanels = usePlannerV2Store((state) => state.catalogPanels);
  const company = usePlannerV2Store((state) => state.companyPlannerDefaults);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);
  const setDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);

  const persisted = React.useMemo(
    () => resolveSurfacePlanning(roof?.surfacePlanning),
    [roof?.surfacePlanning],
  );
  const advancedConfig = draft?.targetMode === "advanced"
    ? draft.config
    : !draft && persisted.status === "supported-advanced"
      ? persisted.config
      : undefined;
  const standardDraft = draft?.targetMode === "standard" ? draft : undefined;
  const isAdvanced = Boolean(advancedConfig);
  const opposing = advancedConfig
    ? advancedConfig.advanced.system.systemId === K2_D_DOME_SYSTEM_ID ||
      advancedConfig.advanced.system.systemId === GENERIC_EAST_WEST_SYSTEM_ID
    : false;
  const companyLimits = React.useMemo(() => resolveCompanyThermalFieldLimits({
    company,
    roofKind: isAdvanced ? "flat" : "pitched",
    ...(isAdvanced ? { mountingOrientation: opposing ? "east-west" as const : "south" as const } : {}),
  }), [company, isAdvanced, opposing]);
  const explicitLimits = isAdvanced
    ? advancedConfig?.thermalFieldLimits
    : standardDraft?.thermalFieldLimits ??
      (persisted.status === "supported-standard" ? persisted.config.thermalFieldLimits : undefined);
  const limits = React.useMemo<ThermalFieldLimits>(() => ({
    ...companyLimits,
    ...explicitLimits,
  } as ThermalFieldLimits), [companyLimits, explicitLimits]);
  const usingCompanyDefault = sameLimits(limits, companyLimits);

  const advancedPreview = React.useMemo(() => {
    if (!roof || !advancedConfig || !(mppImage && mppImage > 0)) return null;
    return computeAdvancedPlanningPreview({
      roof,
      config: withEffectiveAdvancedThermalLimits(advancedConfig, company),
      mppImage,
      zones,
      snowGuards,
    });
  }, [advancedConfig, company, mppImage, roof, snowGuards, zones]);

  const steps = React.useMemo(() => {
    if (limits.kind === "pitched-grid") {
      const panelId = standardDraft?.panelSpecId ?? selectedPanelId;
      const panel = catalogPanels.find((item) => item.id === panelId);
      if (!panel) return null;
      const displayedModules = standardDraft?.modules ?? modules;
      const spacing = resolveStandardAutoLayoutSpacingAxes(displayedModules);
      const unitX = displayedModules.orientation === "portrait" ? panel.widthM : panel.heightM;
      const unitY = displayedModules.orientation === "portrait" ? panel.heightM : panel.widthM;
      return {
        firstLabel: "Max. Module am First",
        firstValue: resolveMaximumWholeUnits({ unitExtentM: unitX, regularPitchM: unitX + spacing.x, fieldLimitM: limits.maxRowDirectionM }),
        secondLabel: "Max. Reihen im Gefälle",
        secondValue: resolveMaximumWholeUnits({ unitExtentM: unitY, regularPitchM: unitY + spacing.y, fieldLimitM: limits.maxColumnDirectionM }),
      };
    }
    const first = advancedPreview?.valid ? advancedPreview.blocks.find((block) => block.valid) : undefined;
    if (!first || !advancedConfig || !advancedPreview?.derived || !(mppImage && mppImage > 0)) return null;
    const radians = (-first.rotationCanvasDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const local = first.footprintPx.map((point) => ({
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    }));
    const unitX = (Math.max(...local.map((point) => point.x)) - Math.min(...local.map((point) => point.x))) * mppImage;
    const unitY = (Math.max(...local.map((point) => point.y)) - Math.min(...local.map((point) => point.y))) * mppImage;
    const pitchX = advancedPreview.derived.kind === "generic"
      ? advancedPreview.derived.pitchXM
      : advancedConfig.advanced.module.heightM + advancedPreview.derived.moduleLongSideSpacingM;
    const pitchY = advancedPreview.derived.kind === "generic"
      ? advancedPreview.derived.pitchYM
      : getAdvancedRowSpaceM(advancedConfig);
    return {
      ...(limits.maxModuleLongSideDirectionM !== undefined ? {
        firstLabel: "Max. Blöcke pro Reihe",
        firstValue: resolveMaximumWholeUnits({ unitExtentM: unitX, regularPitchM: pitchX, fieldLimitM: limits.maxModuleLongSideDirectionM }),
      } : {}),
      secondLabel: "Max. Reihen pro Feld",
      secondValue: resolveMaximumWholeUnits({ unitExtentM: unitY, regularPitchM: pitchY, fieldLimitM: limits.maxRailDirectionM }),
    };
  }, [advancedConfig, advancedPreview, catalogPanels, limits, modules, mppImage, selectedPanelId, standardDraft]);

  if (!roof || roof.id !== selectedId || (!isAdvanced && limits.kind !== "pitched-grid")) return null;

  const updateLimits = (next: ThermalFieldLimits) => {
    if (advancedConfig && next.kind === "flat-block") {
      setDraft(roof.id, { targetMode: "advanced", config: { ...advancedConfig, thermalFieldLimits: next } });
      return;
    }
    if (next.kind !== "pitched-grid") return;
    const base = standardDraft ?? createStandardPlanningDraft({
      panelSpecId: selectedPanelId,
      modules,
      moduleTilt: resolveStandardTiltInput(roof.surfacePlanning),
      thermalFieldLimits: next,
    });
    setDraft(roof.id, { ...base, thermalFieldLimits: next });
  };
  const patch = (value: Partial<ThermalFieldLimits>) => updateLimits({ ...limits, ...value } as ThermalFieldLimits);

  return (
    <section className="space-y-2 rounded-xl border border-border bg-secondary/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Thermische Feldgrenzen</h3>
        {usingCompanyDefault && (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-medium text-primary">
            Firmenstandard
          </span>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Diese Grenzen steuern die Feldaufteilung. Sie erfolgt automatisch gleichmäßig in ganzen Modulen bzw. Blöcken.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[10px] text-muted-foreground">
          {limits.kind === "pitched-grid" ? "Max. Länge · First" : "Max. Länge · Reihen"}
          <span className="flex items-center gap-1">
            <input className={inputClass} type="number" min={0.1} max={100} step={0.1}
              value={limits.kind === "pitched-grid" ? limits.maxRowDirectionM : limits.maxRailDirectionM}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!isValidThermalFieldLimitM(value)) return;
                patch(limits.kind === "pitched-grid" ? { maxRowDirectionM: value } : { maxRailDirectionM: value });
              }} />
            <span>m</span>
          </span>
        </label>
        {(limits.kind === "pitched-grid" || limits.maxModuleLongSideDirectionM !== undefined) && (
          <label className="space-y-1 text-[10px] text-muted-foreground">
            {limits.kind === "pitched-grid" ? "Max. Breite · Gefälle" : "Max. Breite · Modul"}
            <span className="flex items-center gap-1">
              <input className={inputClass} type="number" min={0.1} max={100} step={0.1}
                value={limits.kind === "pitched-grid" ? limits.maxColumnDirectionM : limits.maxModuleLongSideDirectionM}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!isValidThermalFieldLimitM(value)) return;
                  patch(limits.kind === "pitched-grid" ? { maxColumnDirectionM: value } : { maxModuleLongSideDirectionM: value });
                }} />
              <span>m</span>
            </span>
          </label>
        )}
      </div>
      {steps && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-muted/15 p-2 text-[10px]">
          {steps.firstLabel && <><span className="text-muted-foreground">{steps.firstLabel}</span><strong className="text-right">{steps.firstValue}</strong></>}
          <span className="text-muted-foreground">{steps.secondLabel}</span><strong className="text-right">{steps.secondValue}</strong>
        </div>
      )}
      <label className="space-y-1 text-[10px] text-muted-foreground">
        Thermischer Trennabstand
        <span className="flex items-center gap-1">
          <input className={inputClass} type="number" min={0} max={5000} step={1}
            value={(limits.thermalSeparationGapM ?? 0.14) * 1000}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 5000) patch({ thermalSeparationGapM: value / 1000 });
            }} />
          <span>mm</span>
        </span>
      </label>
      {!usingCompanyDefault && (
        <button type="button" className="text-[9px] text-primary hover:underline" onClick={() => updateLimits(companyLimits)}>
          Auf Firmenstandard zurücksetzen
        </button>
      )}
    </section>
  );
}
