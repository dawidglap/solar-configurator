"use client";

import React from "react";
import toast from "react-hot-toast";
import { Settings2 } from "lucide-react";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import {
  isValidModuleSpacingMm,
  resolveCompanyFlatRoofSpacingDefaults,
} from "@/lib/planning/companyPlannerDefaults";
import {
  computeAdvancedPlanningPreview,
  type AdvancedPlanningPreview,
  DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG,
  DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M,
  getAdvancedRowSpaceM,
  getAdvancedServiceCorridorM,
  replaceAdvancedDraftModule,
  updateDefaultFlatSystem,
} from "./advancedPlanningApplication";
import { withEffectiveAdvancedThermalLimits } from "./advancedThermalDefaults";
import DirectLayoutControl from "../panels/DirectLayoutControl";
import { history as plannerHistory } from "../../state/history";
import { buildAdvancedExistingLayoutReflow } from "../panels/existingLayoutReflow";
import CompanySpacingDefaultsDialog from "./CompanySpacingDefaultsDialog";

const inputClass =
  "glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

// Customer requested hiding the module-orientation readout from Modulplanung.
// Keep this render path dormant for a possible re-enable without touching the
// canonical azimuth state used by placement, snapping and layout rotation.
const SHOW_MODULE_ORIENTATION_READOUT = false;

const fmt = (value: number, digits = 2) =>
  new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const normalizeAzimuth = (value: number) => ((value % 360) + 360) % 360;

function MetricCommitInput({
  id,
  value,
  unit,
  onCommit,
  ariaLabel,
}: {
  id: string;
  value: number;
  unit: string;
  onCommit: (value: number) => boolean;
  ariaLabel: string;
}) {
  const formatted = React.useMemo(() => String(Math.round(value * 100) / 100), [value]);
  const [text, setText] = React.useState(formatted);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => setText(formatted), [formatted]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const parsed = Number(text.replace(",", "."));
    if (!Number.isFinite(parsed) || !onCommit(parsed)) setText(formatted);
  };

  return (
    <span className="relative block min-w-0">
      <input
        id={id}
        aria-label={ariaLabel}
        className={`${inputClass} appearance-none pr-8 text-right [MozAppearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            setText(formatted);
            event.currentTarget.blur();
          }
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground">{unit}</span>
    </span>
  );
}

const UNSELECTED_MODE_PREVIEW: AdvancedPlanningPreview = {
  valid: false,
  errors: [],
  warnings: [],
  blocks: [],
  modules: [],
  montageFields: [],
  montageFieldCount: 0,
  thermalFields: [],
  thermalFieldCount: 0,
  blockCount: 0,
  moduleCount: 0,
  derived: null,
  quantity: null,
};

function MountingChoiceGraphic({ opposing }: { opposing: boolean }) {
  return (
    <svg viewBox="0 0 72 28" aria-hidden="true" className="h-7 w-16">
      <path d="M5 24H67" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      {opposing ? (
        <>
          <path d="M8 21L33 8L33 21Z" fill="currentColor" opacity="0.22" />
          <path d="M39 21L39 8L64 21Z" fill="currentColor" opacity="0.22" />
          <path d="M8 21L33 8M39 8L64 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M12 21L56 8L61 21Z" fill="currentColor" opacity="0.22" />
          <path d="M12 21L56 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

type Props = {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  isDraft: boolean;
  previewEnabled?: boolean;
  activeMode?: "south" | "east-west";
  onSelectMode: (mode: "south" | "east-west") => void;
};

export default function AdvancedModulesPanel({
  roof,
  config,
  isDraft,
  previewEnabled = true,
  activeMode,
  onSelectMode,
}: Props) {
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);
  const panels = usePlannerV2Store((state) => state.panels);
  const catalogPanels = usePlannerV2Store((state) => state.catalogPanels);
  const setDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);
  const companyPlannerDefaults = usePlannerV2Store(
    (state) => state.companyPlannerDefaults,
  );
  const clearDraft = usePlannerV2Store((state) => state.clearRoofPlanningDraft);
  const commitRoofLayout = usePlannerV2Store((state) => state.commitRoofLayout);
  const [spacingError, setSpacingError] = React.useState<string | null>(null);
  const [companyDefaultsOpen, setCompanyDefaultsOpen] = React.useState(false);

  const update = React.useCallback(
    (next: AdvancedSurfacePlanningV1) => {
      setDraft(roof.id, {
        targetMode: "advanced",
        // Configuration changes stay non-geometric until U/F/single placement.
        previewEnabled: false,
        config: next,
      });
    },
    [roof.id, setDraft],
  );

  const system = config.advanced.system;
  const isSDome = system.systemId === K2_S_DOME_SYSTEM_ID;
  const isDDome = system.systemId === K2_D_DOME_SYSTEM_ID;
  const isGenericSouth = system.systemId === GENERIC_SOUTH_SYSTEM_ID;
  const isGenericEastWest = system.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  const isK2System = isSDome || isDDome;
  const isSupportedSystem = isK2System || isGenericSouth || isGenericEastWest;
  const isSouthSystem = isSDome || isGenericSouth;
  const isOpposingSystem = isDDome || isGenericEastWest;
  const orientation = isSouthSystem ? "south" : "east-west";
  const azimuth = isSouthSystem
    ? system.faceAzimuthDeg
    : isOpposingSystem
      ? system.primaryFaceAzimuthDeg
      : 90;
  const rowSpaceM = getAdvancedRowSpaceM(config);
  const companySpacingDefaults = React.useMemo(
    () => resolveCompanyFlatRoofSpacingDefaults({
      company: companyPlannerDefaults,
      orientation,
    }),
    [companyPlannerDefaults, orientation],
  );
  const effectiveConfig = React.useMemo(
    () => withEffectiveAdvancedThermalLimits(config, companyPlannerDefaults),
    [companyPlannerDefaults, config],
  );
  const preview = React.useMemo(
    () => activeMode && previewEnabled
      ? computeAdvancedPlanningPreview({
        roof,
        config: effectiveConfig,
        mppImage: mppImage ?? 0,
        zones,
        snowGuards,
      })
      : UNSELECTED_MODE_PREVIEW,
    [activeMode, previewEnabled, roof, effectiveConfig, mppImage, zones, snowGuards],
  );
  const nominalTiltDeg = "nominalTiltDeg" in system ? system.nominalTiltDeg : 10;
  const moduleGapM = "moduleGapX" in system ? system.moduleGapX ?? 0.018 : 0.018;
  const moduleId = config.advanced.module.panelSpecId ?? "";
  const selectedCatalogPanel = catalogPanels.find((panel) => panel.id === moduleId);

  const commitSpacingValues = React.useCallback((values: Partial<{
    rowSpaceM: number;
    serviceCorridorM: number;
    moduleGapM: number;
    nominalTiltDeg: number;
  }>) => {
    const valuesAreValid = Object.entries(values).every(([field, value]) => {
      if (!Number.isFinite(value)) return false;
      if (field === "moduleGapM") return isValidModuleSpacingMm(value * 1000);
      if (field === "nominalTiltDeg") {
        return value >= DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG.min && value <= DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG.max;
      }
      if (field === "serviceCorridorM") {
        return value >= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.min && value <= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.max;
      }
      return value > DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.min && value <= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.max;
    });
    if (!valuesAreValid || !isSupportedSystem || !(mppImage && mppImage > 0)) {
      setSpacingError("Bitte einen gültigen Wert eingeben.");
      return false;
    }
    const next = updateDefaultFlatSystem({
      config,
      orientation,
      ...values,
    });
    const resolved = resolveSurfacePlanning(roof.surfacePlanning);
    const previousConfig = resolved.status === "supported-advanced" ? resolved.config : config;
    if (
      (values.rowSpaceM !== undefined && Math.abs(getAdvancedRowSpaceM(next) - values.rowSpaceM) > 1e-6) ||
      (values.serviceCorridorM !== undefined && values.rowSpaceM === undefined && Math.abs(getAdvancedServiceCorridorM(next) - values.serviceCorridorM) > 1e-6)
    ) {
      setSpacingError("Dieser Abstand ist mit der aktuellen Modulgeometrie nicht möglich.");
      return false;
    }
    const candidate = buildAdvancedExistingLayoutReflow({
      roof,
      currentPanels: panels,
      previousConfig,
      nextConfig: withEffectiveAdvancedThermalLimits(next, companyPlannerDefaults),
      mppImage,
      zones,
      snowGuards,
    });
    if (!candidate) {
      setSpacingError("Die bestehende Belegung passt mit diesem Wert nicht vollständig auf die Dachfläche.");
      toast.error("Abstand nicht übernommen: Die bestehende Belegung wäre ungültig.");
      return false;
    }
    setSpacingError(null);
    plannerHistory.push("Abstände ändern");
    commitRoofLayout({
      roofId: roof.id,
      panels: candidate.panels,
      surfacePlanning: candidate.surfacePlanning,
    });
    return true;
  }, [companyPlannerDefaults, config, commitRoofLayout, isSupportedSystem, mppImage, orientation, panels, roof, snowGuards, zones]);

  const commitSpacingChange = React.useCallback((
    field: "rowSpaceM" | "serviceCorridorM" | "moduleGapM" | "nominalTiltDeg",
    value: number,
  ) => commitSpacingValues({ [field]: value }), [commitSpacingValues]);

  const currentSpacingValues = React.useMemo(() => ({
    rowSpaceM,
    serviceCorridorM: getAdvancedServiceCorridorM(config),
    moduleGapMm: moduleGapM * 1000,
    nominalTiltDeg,
  }), [config, moduleGapM, nominalTiltDeg, rowSpaceM]);
  const differsFromCompanyDefaults = (
    Math.abs(currentSpacingValues.rowSpaceM - companySpacingDefaults.rowSpaceM) > 0.005 ||
    Math.abs(currentSpacingValues.serviceCorridorM - companySpacingDefaults.serviceCorridorM) > 0.005 ||
    Math.abs(currentSpacingValues.moduleGapMm - companySpacingDefaults.moduleGapMm) > 0.05 ||
    Math.abs(currentSpacingValues.nominalTiltDeg - companySpacingDefaults.nominalTiltDeg) > 0.005
  );
  const resetCurrentRoofToCompanyDefaults = React.useCallback(() => commitSpacingValues({
    rowSpaceM: companySpacingDefaults.rowSpaceM,
    serviceCorridorM: companySpacingDefaults.serviceCorridorM,
    moduleGapM: companySpacingDefaults.moduleGapMm / 1000,
    nominalTiltDeg: companySpacingDefaults.nominalTiltDeg,
  }), [commitSpacingValues, companySpacingDefaults]);

  if (config.surface.kind !== "flat" || !isSupportedSystem) {
    return (
      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] text-muted-foreground">
        Diese bestehende Dachkonfiguration bleibt gespeichert, kann in diesem Workflow aber nicht neu erstellt werden.
      </p>
    );
  }

  if (!activeMode) {
    return (
      <div className="space-y-3">
        <section className="space-y-2 border-b border-border/60 pb-4">
          <h3 className={labelClass}>Aufständerung</h3>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Aufständerung">
            <button type="button" aria-pressed={false} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border/70 bg-muted/10 px-2 py-2 text-[11px] font-semibold text-muted-foreground hover:border-primary/40" onClick={() => onSelectMode("south")}>
              <MountingChoiceGraphic opposing={false} /><span>Süd</span><span className="text-[9px] font-normal opacity-75">Standardsystem</span>
            </button>
            <button type="button" aria-pressed={false} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border/70 bg-muted/10 px-2 py-2 text-[11px] font-semibold text-muted-foreground hover:border-primary/40" onClick={() => onSelectMode("east-west")}>
              <MountingChoiceGraphic opposing /><span>Ost-West</span><span className="text-[9px] font-normal opacity-75">Standardsystem</span>
            </button>
          </div>
        </section>
        <p className="rounded-lg border border-border/70 bg-muted/15 p-3 text-[10px] text-muted-foreground">
          Wähle Süd oder Ost-West. Danach werden die Module direkt auf dieser Dachfläche platziert.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2 border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className={labelClass}>Aufständerung</h3>
          {isDraft && (
            <button
              type="button"
              onClick={() => clearDraft(roof.id)}
              className="text-[9px] text-primary hover:underline"
            >
              Auswahl zurücksetzen
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Aufständerung">
          <button
            type="button"
            aria-pressed={activeMode === "south"}
            className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${activeMode === "south" ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/25" : "border-border/70 bg-muted/10 text-muted-foreground hover:border-primary/40"}`}
            onClick={() => onSelectMode("south")}
          >
            <MountingChoiceGraphic opposing={false} />
            <span>Süd</span>
            <span className="text-[9px] font-normal opacity-75">Standardsystem</span>
          </button>
          <button
            type="button"
            aria-pressed={activeMode === "east-west"}
            className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${activeMode === "east-west" ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/25" : "border-border/70 bg-muted/10 text-muted-foreground hover:border-primary/40"}`}
            onClick={() => onSelectMode("east-west")}
          >
            <MountingChoiceGraphic opposing />
            <span>Ost-West</span>
            <span className="text-[9px] font-normal opacity-75">Standardsystem</span>
          </button>
        </div>
      </section>

      <section className="space-y-2 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Modul</h3>
        <select
          id={`advanced-module-${roof.id}`}
          aria-label="Modul wählen"
          title={selectedCatalogPanel
            ? `${selectedCatalogPanel.brand} ${selectedCatalogPanel.model} — ${selectedCatalogPanel.wp} W`
            : undefined}
          className={`${inputClass} min-w-0 truncate`}
          value={moduleId}
          onChange={(event) => {
            const panel = catalogPanels.find((item) => item.id === event.target.value);
            if (panel) update(replaceAdvancedDraftModule({ config, panel }));
          }}
        >
          {catalogPanels.map((panel) => (
            <option key={panel.id} value={panel.id}>
              {panel.brand} {panel.model} — {panel.wp} W
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-3 border-b border-border/60 pb-4">
        {SHOW_MODULE_ORIENTATION_READOUT && (
          <>
            <h3 className={labelClass}>Ausrichtung</h3>
            <div className="flex items-center justify-between rounded-lg bg-muted/15 px-3 py-2 text-[10px]">
              <span className="text-muted-foreground">Modulausrichtung</span>
              <strong>{isOpposingSystem ? `${fmt(azimuth, 0)}° / ${fmt(normalizeAzimuth(azimuth + 180), 0)}°` : `${fmt(azimuth, 0)}°`}</strong>
            </div>
          </>
        )}
        <div className="rounded-xl border border-border/60 text-[10px]">
          <div className="px-3 py-2.5 font-medium uppercase tracking-wide text-muted-foreground">Feinjustierung</div>
          <div className="space-y-3 border-t border-border/60 p-3">
            <DirectLayoutControl roofId={roof.id} />
            <div className="border-t border-border/60 pt-2 text-muted-foreground"><p>System: Standardsystem</p></div>
            {preview.warnings.some((warning) => warning.code.includes("block-size")) && (
              <p className="text-amber-700 dark:text-amber-300">Die K2 Blockgrösse überschreitet die dokumentierte Systemgrenze.</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2 border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className={labelClass}>Abstände</h3>
            {differsFromCompanyDefaults && (
              <span className="text-[9px] text-muted-foreground">· Abweichend</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCompanyDefaultsOpen(true)}
            className="flex items-center gap-1 text-[9px] font-medium text-primary hover:underline"
          >
            Firmenstandard
            <Settings2 className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(92px,2fr)] items-center gap-x-3 gap-y-2 text-[10px] text-muted-foreground">
          <label htmlFor={`advanced-row-space-${roof.id}`}>Reihenabstand</label>
          <MetricCommitInput id={`advanced-row-space-${roof.id}`} ariaLabel="Reihenabstand" value={rowSpaceM} unit="m" onCommit={(value) => commitSpacingChange("rowSpaceM", value)} />
          <label htmlFor={`advanced-service-corridor-${roof.id}`}>Wartungsgang</label>
          <MetricCommitInput id={`advanced-service-corridor-${roof.id}`} ariaLabel="Wartungsgang" value={getAdvancedServiceCorridorM(config)} unit="m" onCommit={(value) => commitSpacingChange("serviceCorridorM", value)} />
          <label htmlFor={`advanced-module-gap-${roof.id}`}>Modulabstand</label>
          <MetricCommitInput id={`advanced-module-gap-${roof.id}`} ariaLabel="Modulabstand" value={moduleGapM * 1000} unit="mm" onCommit={(value) => commitSpacingChange("moduleGapM", value / 1000)} />
          <label htmlFor={`advanced-module-tilt-${roof.id}`}>Modulneigung</label>
          <MetricCommitInput id={`advanced-module-tilt-${roof.id}`} ariaLabel="Modulneigung" value={nominalTiltDeg} unit="°" onCommit={(value) => commitSpacingChange("nominalTiltDeg", value)} />
        </div>
        {spacingError && <p className="text-[10px] leading-snug text-destructive" role="alert">{spacingError}</p>}
      </section>

      <CompanySpacingDefaultsDialog
        open={companyDefaultsOpen}
        orientation={orientation}
        defaults={companySpacingDefaults}
        differsFromCurrentRoof={differsFromCompanyDefaults}
        onClose={() => setCompanyDefaultsOpen(false)}
        onResetCurrentRoof={resetCurrentRoofToCompanyDefaults}
        onBeforeCompanyDefaultsUpdate={() => {
          if (roof.surfacePlanning === undefined && !isDraft) update(config);
        }}
      />

      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
        Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
      </p>
    </div>
  );
}
