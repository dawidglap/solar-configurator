"use client";

import React from "react";
import toast from "react-hot-toast";

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
import { isValidModuleSpacingMm } from "@/lib/planning/companyPlannerDefaults";
import {
  computeAdvancedPlanningPreview,
  type AdvancedPlanningPreview,
  DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG,
  DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M,
  getAdvancedRowSpaceM,
  getAdvancedServiceCorridorM,
  replaceAdvancedDraftModule,
  setAdvancedFixedQuantity,
  setAdvancedQuantityMode,
  updateDefaultFlatSystem,
} from "./advancedPlanningApplication";
import { withEffectiveAdvancedThermalLimits } from "./advancedThermalDefaults";
import { buildGuidedPlanningResult } from "./guidedPlanningPresentation";
import DirectLayoutControl from "../panels/DirectLayoutControl";
import { history as plannerHistory } from "../../state/history";
import { buildAdvancedExistingLayoutReflow } from "../panels/existingLayoutReflow";

const inputClass =
  "glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

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
  const quantityMode = config.advanced.layout.quantityMode ?? "auto";
  const blocksPerRow = config.advanced.layout.blocksPerRow ?? 5;
  const rowCount = config.advanced.layout.rowCount ?? 3;
  const requestedBlocks = blocksPerRow * rowCount;
  const requestedModules = requestedBlocks * (isOpposingSystem ? 2 : 1);
  const selectedCatalogPanel = catalogPanels.find((panel) => panel.id === moduleId);
  const previewQuantity = preview.quantity;
  const committedRoofPanels = panels.filter((panel) => panel.roofId === roof.id);
  const committedBlockKeys = new Set(
    committedRoofPanels.flatMap((panel) => panel.advanced?.blockKey ? [panel.advanced.blockKey] : []),
  );
  const committedFieldKeys = new Set(
    committedRoofPanels.flatMap((panel) => panel.advanced?.montageFieldKey ? [panel.advanced.montageFieldKey] : []),
  );
  const committedThermalFieldKeys = new Set(
    committedRoofPanels.flatMap((panel) => panel.advanced?.thermalFieldKey ? [panel.advanced.thermalFieldKey] : []),
  );
  const manuallyAdjusted = committedRoofPanels.some((panel) =>
    panel.advanced?.layoutRunId?.startsWith("manual-") ||
    panel.advanced?.blockKey?.includes(":manual-"),
  );
  const useCommittedResult = (!isDraft || !previewEnabled) && committedRoofPanels.length > 0;
  const result = buildGuidedPlanningResult({
    valid: preview.valid,
    quantityMode,
    requestedBlockCount: useCommittedResult ? committedBlockKeys.size : previewQuantity?.requestedBlockCount ?? preview.blockCount,
    validBlockCount: useCommittedResult ? committedBlockKeys.size : previewQuantity?.validBlockCount ?? preview.blockCount,
    requestedModuleCount: useCommittedResult ? committedRoofPanels.length : previewQuantity?.requestedModuleCount ?? preview.moduleCount,
    validModuleCount: useCommittedResult ? committedRoofPanels.length : previewQuantity?.validModuleCount ?? preview.moduleCount,
    blocksPerRow,
    rowCount,
    powerW: config.advanced.module.powerW,
    montageFieldCount: useCommittedResult ? committedFieldKeys.size : preview.montageFieldCount,
    manuallyAdjusted: useCommittedResult && manuallyAdjusted,
  });

  const commitSpacingChange = React.useCallback((
    field: "rowSpaceM" | "serviceCorridorM" | "moduleGapM" | "nominalTiltDeg",
    value: number,
  ) => {
    const valueIsValid = field === "moduleGapM"
      ? isValidModuleSpacingMm(value * 1000)
      : field === "nominalTiltDeg"
        ? value >= DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG.min && value <= DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG.max
        : field === "serviceCorridorM"
          ? value >= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.min && value <= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.max
          : value > DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.min && value <= DEFAULT_FLAT_SYSTEM_SPACING_RANGE_M.max;
    if (!Number.isFinite(value) || !valueIsValid || !isSupportedSystem || !(mppImage && mppImage > 0)) {
      setSpacingError("Bitte einen gültigen Wert eingeben.");
      return false;
    }
    const next = updateDefaultFlatSystem({
      config,
      orientation,
      ...(field === "rowSpaceM" ? { rowSpaceM: value } : {}),
      ...(field === "serviceCorridorM" ? { serviceCorridorM: value } : {}),
      ...(field === "nominalTiltDeg" ? { nominalTiltDeg: value } : {}),
      ...(field === "moduleGapM" ? { moduleGapM: value } : {}),
    });
    const resolved = resolveSurfacePlanning(roof.surfacePlanning);
    const previousConfig = resolved.status === "supported-advanced" ? resolved.config : config;
    if (
      (field === "rowSpaceM" && Math.abs(getAdvancedRowSpaceM(next) - value) > 1e-6) ||
      (field === "serviceCorridorM" && Math.abs(getAdvancedServiceCorridorM(next) - value) > 1e-6)
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
        <h3 className={labelClass}>Aufständerung</h3>
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
        <h3 className={labelClass}>Anzahl</h3>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1" role="group" aria-label="Anzahl">
          <button
            type="button"
            aria-pressed={quantityMode === "auto"}
            className={`h-9 rounded-lg text-[10px] font-medium ${quantityMode === "auto" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedQuantityMode({ config, mode: "auto" }))}
          >
            Automatisch
          </button>
          <button
            type="button"
            aria-pressed={quantityMode === "fixed"}
            className={`h-9 rounded-lg text-[10px] font-medium ${quantityMode === "fixed" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedQuantityMode({ config, mode: "fixed" }))}
          >
            Anzahl festlegen
          </button>
        </div>
        {quantityMode === "auto" && (
          <p className="text-[10px] text-muted-foreground">
            {preview.blockCount} Blöcke · {preview.moduleCount} Module
          </p>
        )}
        {quantityMode === "fixed" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5 text-[10px] text-muted-foreground">
                Blöcke pro Reihe
                <span className="grid grid-cols-[30px_1fr_30px] overflow-hidden rounded-lg border border-border">
                  <button type="button" aria-label="Weniger Blöcke pro Reihe" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, blocksPerRow: Math.max(1, blocksPerRow - 1) }))}>−</button>
                  <input className="h-8 w-full border-x border-border bg-transparent text-center text-[11px] text-foreground outline-none" type="number" min={1} max={100} step={1} value={blocksPerRow} onChange={(event) => update(setAdvancedFixedQuantity({ config, blocksPerRow: Number(event.target.value) }))} />
                  <button type="button" aria-label="Mehr Blöcke pro Reihe" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, blocksPerRow: Math.min(100, blocksPerRow + 1) }))}>+</button>
                </span>
              </label>
              <label className="space-y-1.5 text-[10px] text-muted-foreground">
                Reihen
                <span className="grid grid-cols-[30px_1fr_30px] overflow-hidden rounded-lg border border-border">
                  <button type="button" aria-label="Weniger Reihen" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, rowCount: Math.max(1, rowCount - 1) }))}>−</button>
                  <input className="h-8 w-full border-x border-border bg-transparent text-center text-[11px] text-foreground outline-none" type="number" min={1} max={100} step={1} value={rowCount} onChange={(event) => update(setAdvancedFixedQuantity({ config, rowCount: Number(event.target.value) }))} />
                  <button type="button" aria-label="Mehr Reihen" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, rowCount: Math.min(100, rowCount + 1) }))}>+</button>
                </span>
              </label>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/15 p-3 text-center text-[11px] leading-relaxed">
              <strong>{blocksPerRow} × {rowCount}</strong>
              <span className="block text-muted-foreground">= {requestedBlocks} Blöcke</span>
              <span className="block font-semibold text-foreground">= {requestedModules} Module</span>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Ausrichtung</h3>
        <div className="flex items-center justify-between rounded-lg bg-muted/15 px-3 py-2 text-[10px]">
          <span className="text-muted-foreground">Modulausrichtung</span>
          <strong>{isOpposingSystem ? `${fmt(azimuth, 0)}° / ${fmt(normalizeAzimuth(azimuth + 180), 0)}°` : `${fmt(azimuth, 0)}°`}</strong>
        </div>
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
          <h3 className={labelClass}>Abstände</h3>
          <span className="text-[9px] text-muted-foreground">Werte direkt anpassen</span>
        </div>
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(92px,2fr)] items-center gap-x-3 gap-y-2 text-[10px] text-muted-foreground">
          <label htmlFor={`advanced-row-space-${roof.id}`}>Reihenabstand</label>
          <MetricCommitInput id={`advanced-row-space-${roof.id}`} ariaLabel="Reihenabstand" value={rowSpaceM} unit="m" onCommit={(value) => commitSpacingChange("rowSpaceM", value)} />
          <label htmlFor={`advanced-service-corridor-${roof.id}`}>Wartungsgang</label>
          <MetricCommitInput id={`advanced-service-corridor-${roof.id}`} ariaLabel="Wartungsgang" value={getAdvancedServiceCorridorM(config)} unit="m" onCommit={(value) => commitSpacingChange("serviceCorridorM", value)} />
          <label htmlFor={`advanced-module-gap-${roof.id}`}>
            Modulabstand
            {!isK2System && <span className="ml-1 text-[9px] text-primary">Firmenstandard</span>}
          </label>
          <MetricCommitInput id={`advanced-module-gap-${roof.id}`} ariaLabel="Modulabstand" value={moduleGapM * 1000} unit="mm" onCommit={(value) => commitSpacingChange("moduleGapM", value / 1000)} />
          <label htmlFor={`advanced-module-tilt-${roof.id}`}>Modulneigung</label>
          <MetricCommitInput id={`advanced-module-tilt-${roof.id}`} ariaLabel="Modulneigung" value={nominalTiltDeg} unit="°" onCommit={(value) => commitSpacingChange("nominalTiltDeg", value)} />
        </div>
        {spacingError && <p className="text-[10px] leading-snug text-destructive" role="alert">{spacingError}</p>}
      </section>

      <section className={`rounded-xl border p-3 ${result.status === "valid" ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`} aria-live="polite">
        <p className={`text-[12px] font-semibold ${result.status === "valid" ? "text-primary" : "text-destructive"}`}>
          {result.status === "valid" ? "✓ " : ""}{result.title}
        </p>
        {result.validityLabel && <p className="mt-1 text-[10px] font-medium text-destructive">{result.validityLabel}</p>}
        {result.guidance && <p className="mt-1 text-[10px] text-muted-foreground">{result.guidance}</p>}
        {result.status === "valid" && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <span className="text-muted-foreground">Module</span><strong className="text-right">{result.moduleCount}</strong>
            <span className="text-muted-foreground">Blöcke</span><strong className="text-right">{result.blockCount}</strong>
            {(result.montageFieldCount ?? 0) > 0 && <><span className="text-muted-foreground">Montagefelder</span><strong className="text-right">{result.montageFieldCount ?? 0}</strong></>}
            {(useCommittedResult ? committedThermalFieldKeys.size : preview.thermalFieldCount) > 0 && <><span className="text-muted-foreground">Thermische Felder</span><strong className="text-right">{useCommittedResult ? committedThermalFieldKeys.size : preview.thermalFieldCount}</strong></>}
            {result.powerKWp != null && <><span className="text-muted-foreground">Leistung</span><strong className="text-right">{fmt(result.powerKWp)} kWp</strong></>}
            <span className="text-muted-foreground">System</span><span className="text-right">{isSouthSystem ? "Süd · Standardsystem" : "Ost-West · Standardsystem"}</span>
            <span className="text-muted-foreground">Anordnung</span><span className="text-right">{result.arrangementLabel}</span>
          </div>
        )}
      </section>

      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
        Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
      </p>

      {isDraft && (
        <div className="space-y-2 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
          <p>Konfiguration gewählt. Module werden erst mit U, F oder Einzelplatzierung erzeugt.</p>
          <button
            type="button"
            onClick={() => clearDraft(roof.id)}
            className="h-8 w-full rounded-lg border border-border text-[10px] text-foreground"
          >
            Auswahl zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
