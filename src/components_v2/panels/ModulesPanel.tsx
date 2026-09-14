// src/components_v2/modules/ModulesPanel.tsx
"use client";

import React, { useCallback } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import RoofAreaInfo from "../ui/RoofAreaInfo";
import DetectedRoofsImport from "../panels/DetectedRoofsImport";
import { MdViewModule } from "react-icons/md";
import { Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

import {
  resolveSurfacePlanning,
  resolveStandardModuleTilt,
  type AdvancedSurfacePlanningV1,
  type StandardModuleTiltInput,
  type ThermalFieldLimits,
} from "@/lib/planning-core/advanced";
import AdvancedModulesPanel from "../modules/advanced/AdvancedModulesPanel";
import RoofDimensionsControl from "./RoofDimensionsControl";
import RoofTypeChangeDialog from "./RoofTypeChangeDialog";
import RoofMarginControl from "./RoofMarginControl";
import { formatRoofSlopeDirection, resolveRoofFallAzimuth } from "../roof/roofOrientation";
import {
  normalizeRoofAzimuthDeg,
  ROOF_DIRECTION_CHOICES,
  roofAzimuthCardinal,
} from "../roof/roofOrientation";
import { modulesWithRoofEdgeMargin } from "@/lib/planning/roofProperties";
import { resolveRoofGeometricOrientationDeg } from "@/lib/planning-core/geometry-v2";
import {
  COMPANY_MODULE_SPACING_LIMITS_MM,
  isValidModuleSpacingMm,
  resolveCompanyThermalFieldLimits,
} from "@/lib/planning/companyPlannerDefaults";
import {
  createInitialAdvancedPlanning,
  createStandardPlanningDraft,
  resolveStandardTiltInput,
  resolveInitialSonnendachRoofType,
  resolveRoofPlanningMode,
  resolveRoofModuleMode,
  setAdvancedMountingOrientation,
  alignAdvancedLayoutParallelToRoofEdge,
} from "../modules/advanced/advancedPlanningApplication";
import ZonePropertiesControl from "../zones/ZonePropertiesControl";
import DirectLayoutControl from "../modules/panels/DirectLayoutControl";

type Pt = { x: number; y: number };

const inputBase =
  "glass-input h-8 w-full rounded-lg px-2 py-0 text-[11px] leading-none " +
  "focus:ring-1 focus:ring-primary/40 transition";

const labelSm =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

export default function ModulesPanel() {
  // --- Layers / selezione tetto ---
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const select = usePlannerV2Store((s) => s.select);
  const delLayer = usePlannerV2Store((s) => s.deleteLayer);
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage);
  const detected = usePlannerV2Store((s) => s.detectedRoofs);
  const step = usePlannerV2Store((s) => s.step);
  const showPanelsInBuilding = usePlannerV2Store(
    (s) => s.ui.showPanelsInBuilding,
  );
  const setUI = usePlannerV2Store((s) => s.setUI);

  // --- Moduli / pannelli ---
  const panels = usePlannerV2Store((s) => s.panels);
  const modules = usePlannerV2Store((s) => s.modules);
  const setModules = usePlannerV2Store((s) => s.setModules);
  const companyPlannerDefaults = usePlannerV2Store(
    (s) => s.companyPlannerDefaults,
  );
  const selSpec = usePlannerV2Store((s) => s.getSelectedPanel());
  const snapshot = usePlannerV2Store((s) => s.snapshot);

  // --- Catalogo PV (spostato qui dalla topbar) ---
  const catalogPanels = usePlannerV2Store((s) => s.catalogPanels);
  const selectedPanelId = usePlannerV2Store((s) => s.selectedPanelId);
  const roofPlanningDrafts = usePlannerV2Store((s) => s.roofPlanningDrafts);
  const setRoofPlanningDraft = usePlannerV2Store((s) => s.setRoofPlanningDraft);
  const clearRoofPlanningDraft = usePlannerV2Store(
    (s) => s.clearRoofPlanningDraft,
  );
  const commitRoofLayout = usePlannerV2Store((s) => s.commitRoofLayout);

  // --- Edit inline tilt/az (spostato sotto per evitare TDZ) ---
  const updateRoof = usePlannerV2Store((s) => s.updateRoof);
  const [editing, setEditing] = React.useState<{
    id: string;
    field: "tilt" | "az";
  } | null>(null);
  const [tempVal, setTempVal] = React.useState<string>("");
  const [azimuthMode, setAzimuthMode] = React.useState<"preset" | "custom">("custom");
  const lastCustomAzimuthByRoofRef = React.useRef<Map<string, number>>(new Map());
  const [pendingRoofType, setPendingRoofType] = React.useState<
    "pitched" | "flat" | null
  >(null);
  const [moduleTiltText, setModuleTiltText] = React.useState("");

  const selectedRoof = React.useMemo(
    () => layers.find((roof) => roof.id === selectedId),
    [layers, selectedId],
  );
  const selectedDraft = selectedId ? roofPlanningDrafts[selectedId] : undefined;
  const activeModuleMode = resolveRoofModuleMode({
    roof: selectedRoof,
    roofId: selectedRoof?.id,
    panels,
    draft: selectedDraft,
  });
  const persistedPlanning = resolveSurfacePlanning(
    selectedRoof?.surfacePlanning,
  );
  const displayMode = resolveRoofPlanningMode({
    persisted: selectedRoof?.surfacePlanning,
    draft: selectedDraft,
    roof: selectedRoof,
  });
  const selectedAdvancedConfig =
    selectedDraft?.targetMode === "advanced"
      ? selectedDraft.config
      : persistedPlanning.status === "supported-advanced"
        ? persistedPlanning.config
        : undefined;
  const inferredSonnendachRoofType = resolveInitialSonnendachRoofType(selectedRoof);
  const implicitFlatConfig = React.useMemo(() => {
    if (
      !selectedRoof ||
      !selSpec ||
      selectedRoof.surfacePlanning !== undefined ||
      selectedDraft ||
      inferredSonnendachRoofType !== "flat"
    ) {
      return undefined;
    }
    const limits = resolveCompanyThermalFieldLimits({
      company: companyPlannerDefaults,
      roofKind: "flat",
      mountingOrientation: "east-west",
    });
    return createInitialAdvancedPlanning({
      panel: selSpec,
      standardModules: modulesWithRoofEdgeMargin(selectedRoof, modules),
      thermalFieldLimits: limits.kind === "flat-block" ? limits : undefined,
    });
  }, [
    companyPlannerDefaults,
    inferredSonnendachRoofType,
    modules,
    selSpec,
    selectedDraft,
    selectedRoof,
  ]);
  const advancedConfig = selectedAdvancedConfig ?? implicitFlatConfig;
  const standardDraft =
    selectedDraft?.targetMode === "standard" ? selectedDraft : undefined;
  const displayedModules = standardDraft?.modules ?? modules;
  const displayedSpacingXM =
    displayedModules.spacingXM ?? displayedModules.spacingM;
  const displayedSpacingYM =
    displayedModules.spacingYM ?? displayedModules.spacingM;
  const displayedPanelId = standardDraft?.panelSpecId ?? selectedPanelId;
  const displayedTiltInput = standardDraft?.moduleTilt ??
    resolveStandardTiltInput(selectedRoof?.surfacePlanning);
  const displayedTilt = resolveStandardModuleTilt({
    moduleTilt: displayedTiltInput,
    roofSlopeDeg: selectedRoof?.tiltDeg,
  });
  const displayedThermalLimits = React.useMemo<
    Extract<ThermalFieldLimits, { kind: "pitched-grid" }>
  >(() => {
    const companyResolved = resolveCompanyThermalFieldLimits({
      company: companyPlannerDefaults,
      roofKind: "pitched",
    });
    const companyLimits: Extract<ThermalFieldLimits, { kind: "pitched-grid" }> =
      companyResolved.kind === "pitched-grid"
        ? companyResolved
        : { kind: "pitched-grid", maxRowDirectionM: 17.6, maxColumnDirectionM: 17.6, thermalSeparationGapM: 0.14 };
    const persisted = resolveSurfacePlanning(selectedRoof?.surfacePlanning);
    return {
      ...companyLimits,
      ...(persisted.status === "supported-standard"
        ? persisted.config.thermalFieldLimits
        : undefined),
      ...standardDraft?.thermalFieldLimits,
    };
  }, [companyPlannerDefaults, selectedRoof?.surfacePlanning, standardDraft?.thermalFieldLimits]);
  const customerRoofType =
    selectedRoof?.roofKind === "pitched"
      ? "pitched"
      : selectedRoof?.roofKind === "flat"
        ? "flat"
        : displayMode === "standard"
      ? "pitched"
      : advancedConfig?.surface.kind === "flat" ||
          (selectedRoof?.surfacePlanning === undefined &&
            inferredSonnendachRoofType === "flat")
        ? "flat"
        : "preserved-green";
  const selectedRoofKind = customerRoofType === "pitched"
    ? "pitched"
    : customerRoofType === "flat"
      ? "flat"
      : "green";
  React.useEffect(() => {
    setModuleTiltText(
      displayedTilt.effectiveTiltDeg === undefined
        ? ""
        : String(Number(displayedTilt.effectiveTiltDeg.toFixed(2))),
    );
  }, [displayedTilt.effectiveTiltDeg, displayedTilt.mode, selectedRoof?.id]);
  const patchDisplayedModules = React.useCallback(
    (patch: Partial<typeof modules>) => {
      if (selectedRoof) {
        setRoofPlanningDraft(selectedRoof.id, {
          ...(standardDraft ?? createStandardPlanningDraft({
            panelSpecId: displayedPanelId,
            modules,
            moduleTilt: displayedTiltInput,
            thermalFieldLimits: displayedThermalLimits.kind === "pitched-grid" ? displayedThermalLimits : undefined,
          })),
          modules: { ...displayedModules, ...patch },
        });
        return;
      }
      setModules(patch);
    },
    [displayedModules, displayedPanelId, displayedThermalLimits, displayedTiltInput, modules, selectedRoof, setModules, setRoofPlanningDraft, standardDraft],
  );

  const patchStandardTilt = React.useCallback((moduleTilt: StandardModuleTiltInput) => {
    if (!selectedRoof) return;
    setRoofPlanningDraft(selectedRoof.id, {
      ...(standardDraft ?? createStandardPlanningDraft({
        panelSpecId: displayedPanelId,
        modules,
        moduleTilt: displayedTiltInput,
        thermalFieldLimits: displayedThermalLimits.kind === "pitched-grid" ? displayedThermalLimits : undefined,
      })),
      moduleTilt,
    });
  }, [displayedPanelId, displayedThermalLimits, displayedTiltInput, modules, selectedRoof, setRoofPlanningDraft, standardDraft]);

  const commitModuleTiltText = React.useCallback(() => {
    const value = Number(moduleTiltText);
    if (!Number.isFinite(value) || value < 0 || value > 90) {
      setModuleTiltText(
        displayedTilt.effectiveTiltDeg === undefined
          ? ""
          : String(Number(displayedTilt.effectiveTiltDeg.toFixed(2))),
      );
      return;
    }
    patchStandardTilt({ mode: "custom", customTiltDeg: value });
  }, [displayedTilt.effectiveTiltDeg, moduleTiltText, patchStandardTilt]);

  const requestRoofTypeChange = React.useCallback(
    (next: "pitched" | "flat") => {
      if (!selectedRoof || customerRoofType === "preserved-green") return;
      if (customerRoofType === next) return;
      setPendingRoofType(next);
    },
    [customerRoofType, selectedRoof],
  );

  const confirmRoofTypeChange = React.useCallback(() => {
    if (!selectedRoof || !pendingRoofType) return;
    commitRoofLayout({ roofId: selectedRoof.id, panels: [] });
    updateRoof(selectedRoof.id, {
      roofKind: pendingRoofType,
      ...(pendingRoofType === "flat" ? { tiltDeg: 0 } : {}),
      // Undefined is the canonical auto mode for flat roofs. The northernmost
      // edge is resolved from geometry until the operator chooses explicitly.
      referenceEdgeIndex: pendingRoofType === "flat" ? undefined : 0,
    });

    setPendingRoofType(null);
    toast.success("Dachtyp geändert. Die Dachfläche kann neu geplant werden.");
  }, [commitRoofLayout, pendingRoofType, selectedRoof, updateRoof]);

  React.useEffect(() => {
    setPendingRoofType(null);
  }, [selectedRoof?.id]);

  // blocca i global hotkeys (anche in capture) quando digiti negli input inline
  const stopHotkeysCapture = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    // prova a bloccare eventuali native listeners in capture
    if (e.nativeEvent?.stopImmediatePropagation)
      e.nativeEvent.stopImmediatePropagation();
  };

  const commitInline = React.useCallback(
    (roofId: string, field: "tilt" | "az", rawText = tempVal) => {
      const raw = Number(rawText.replace(",", "."));
      if (!Number.isFinite(raw)) {
        setEditing(null);
        return;
      }

      const roof = layers.find((candidate) => candidate.id === roofId);
      if (!roof) {
        setEditing(null);
        return;
      }
      const planning = resolveSurfacePlanning(roof.surfacePlanning);
      if (field === "tilt") {
        const v = Math.max(0, Math.min(80, raw));
        const surfacePlanning = planning.status === "supported-standard" || planning.status === "supported-advanced"
          ? {
              ...planning.config,
              surface: { ...planning.config.surface, slopeDeg: v },
            }
          : roof.surfacePlanning;
        updateRoof(roofId, { tiltDeg: v, surfacePlanning });
        const draft = roofPlanningDrafts[roofId];
        if (draft?.targetMode === "advanced") {
          setRoofPlanningDraft(roofId, {
            ...draft,
            config: {
              ...draft.config,
              surface: { ...draft.config.surface, slopeDeg: v },
            },
          });
        }
      } else {
        const stored = normalizeRoofAzimuthDeg(raw);
        const surfacePlanning = planning.status === "supported-standard" || planning.status === "supported-advanced"
          ? {
              ...planning.config,
              surface: { ...planning.config.surface, fallAzimuthDeg: stored },
            }
          : roof.surfacePlanning;
        updateRoof(roofId, { fallAzimuthDeg: stored, surfacePlanning });
        const draft = roofPlanningDrafts[roofId];
        if (draft?.targetMode === "advanced") {
          setRoofPlanningDraft(roofId, {
            ...draft,
            config: {
              ...draft.config,
              surface: { ...draft.config.surface, fallAzimuthDeg: stored },
            },
          });
        }
      }

      setEditing(null);
    },
    [layers, roofPlanningDrafts, setRoofPlanningDraft, tempVal, updateRoof],
  );

  const openInlineEditor = React.useCallback((input: {
    roofId: string;
    field: "tilt" | "az";
    value?: number;
    disabled?: boolean;
  }) => {
    if (input.disabled) return;
    select(input.roofId);
    setTempVal(input.value == null ? "" : String(Math.round(input.value * 100) / 100));
    if (input.field === "az") {
      const isPreset = ROOF_DIRECTION_CHOICES.some(
        (choice) => input.value != null && Math.abs(choice.azimuthDeg - input.value) < 0.01,
      );
      setAzimuthMode(isPreset ? "preset" : "custom");
      if (!isPreset && input.value != null) {
        lastCustomAzimuthByRoofRef.current.set(input.roofId, input.value);
      }
    }
    setEditing({ id: input.roofId, field: input.field });
  }, [select]);

  const requestModuleMode = useCallback((mode: "portrait" | "landscape" | "south" | "east-west") => {
    if (!selectedRoof || activeModuleMode === mode) return;
    if (mode === "portrait" || mode === "landscape") {
      const draft = standardDraft ?? createStandardPlanningDraft({
        panelSpecId: displayedPanelId,
        modules,
        moduleTilt: displayedTiltInput,
        thermalFieldLimits: displayedThermalLimits,
      });
      setRoofPlanningDraft(selectedRoof.id, {
        ...draft,
        previewEnabled: false,
        modules: { ...draft.modules, orientation: mode },
      });
      return;
    }
    if (!selSpec) return;
    const companyLimits = resolveCompanyThermalFieldLimits({
      company: companyPlannerDefaults,
      roofKind: "flat",
      mountingOrientation: mode,
    });
    let config = selectedAdvancedConfig ?? createInitialAdvancedPlanning({
      panel: selSpec,
      standardModules: modulesWithRoofEdgeMargin(selectedRoof, modules),
    });
    config = setAdvancedMountingOrientation({ config, orientation: mode });
    if (snapshot.mppImage) {
      config = alignAdvancedLayoutParallelToRoofEdge({
        config,
        roof: selectedRoof,
        mppImage: snapshot.mppImage,
      });
    }
    if (companyLimits.kind === "flat-block") {
      config = { ...config, thermalFieldLimits: companyLimits };
    }
    setRoofPlanningDraft(selectedRoof.id, {
      targetMode: "advanced",
      previewEnabled: false,
      config,
    });
  }, [activeModuleMode, companyPlannerDefaults, displayedPanelId, displayedThermalLimits, displayedTiltInput, modules, selSpec, selectedAdvancedConfig, selectedRoof, setRoofPlanningDraft, snapshot.mppImage, standardDraft]);

  return (
    <div className="w-full max-w-[240px] space-y-4 p-2 text-foreground">
      {/* === EBENEN (tabella compatta) === */}
      <div className="px-0">
        <div className={`${labelSm} mb-2`}>
          Mg.{layers.length ? ` (${layers.length})` : ""}
        </div>

        {step === "building" && detected?.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-medium text-muted-foreground">
              Erkannte Dächer
            </div>
            <DetectedRoofsImport />
          </div>
        )}

        {layers.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">
            Noch keine Ebenen.
          </p>
        ) : (
          <div className="text-[10px]">
            {step === "building" ? (
              <div className="grid h-8 grid-cols-[28px_42px_48px_minmax(70px,1fr)_32px] items-end px-1 pb-1 text-[8px] font-medium leading-none text-muted-foreground">
                <div>Dach</div>
                <div className="text-right">Fläche</div>
                <div className="text-center">Neigung</div>
                <div className="text-center">Ausrichtung</div>
                <div />
              </div>
            ) : (
              <div className="grid h-6 grid-cols-[1fr_58px_70px] items-center px-1 text-[10px] text-muted-foreground">
                <div className="font-medium">Dachfläche</div>
                <div className="flex items-center justify-center gap-1">
                  <MdViewModule className="h-3 w-3" />
                  <span>Module</span>
                </div>
                <div className="text-right font-medium">kWp</div>
              </div>
            )}

            {/* Righe (monolinea) */}
            <ul className="divide-y divide-border/70">
              {layers.map((l, i) => {
                const roofId = l.id;
                const active = selectedId === roofId;

                const count = panels.filter((p) => p.roofId === roofId).length;
                const kWp = selSpec ? (selSpec.wp / 1000) * count : 0;

                const fmtDe2 = new Intl.NumberFormat("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });

                const rowPlanning = resolveSurfacePlanning(l.surfacePlanning);
                const rowKind = rowPlanning.status === "supported-advanced"
                  ? rowPlanning.config.surface.kind
                  : l.roofKind ?? resolveInitialSonnendachRoofType(l) ?? "pitched";
                const az = rowPlanning.status === "supported-advanced"
                  ? rowPlanning.config.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(l)
                  : resolveRoofFallAzimuth(l);
                const tilt = rowKind === "flat"
                  ? 0
                  : rowPlanning.status === "supported-advanced"
                    ? rowPlanning.config.surface.slopeDeg ?? l.tiltDeg
                    : l.tiltDeg;
                const pitchedInfo = rowKind === "pitched" && typeof tilt === "number" && typeof az === "number"
                  ? formatRoofSlopeDirection(tilt, az)
                  : undefined;

                const tiltShort = tilt != null ? Math.round(tilt * 100) / 100 : undefined;

                const azView = az;
                const azShort = azView != null ? Math.round(azView * 100) / 100 : undefined;
                const geometricOrientation = rowKind === "flat"
                  ? resolveRoofGeometricOrientationDeg(l.points, mpp ?? 0)
                  : undefined;

                const src = l.source;
                const srcBadge =
                  src === "sonnendach" ? "S" : src === "manual" ? "M" : "";
                return (
                  <li key={roofId}>
                    <div
                      onClick={() => select(roofId)}
                      className={[
                        step === "building"
                          ? "grid min-h-9 grid-cols-[28px_42px_48px_minmax(70px,1fr)_32px] items-center px-1"
                          : "grid min-h-10 grid-cols-[1fr_58px_70px] items-center px-1 py-1",
                        active
                          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "glass-row text-foreground",
                      ].join(" ")}
                    >
                      {/* D1/D2 */}
                      <button
                        onClick={() => select(roofId)}
                        title={l.name ?? `D${i + 1}`}
                        aria-label={`Ebene auswählen: ${l.name ?? `D${i + 1}`}`}
                        className="min-w-0 text-left font-semibold cursor-pointer"
                      >
                        <span className="block">{`D${i + 1}`}</span>
                        {step === "modules" && pitchedInfo && (
                          <span className="block truncate text-[8px] font-normal text-muted-foreground">
                            {pitchedInfo}
                          </span>
                        )}
                      </button>

                      {step === "modules" ? (
                        <>
                          <button
                            onClick={() => select(roofId)}
                            title={`${count} Module`}
                            aria-label={`${count} Module`}
                            className="tabular-nums text-center opacity-80"
                          >
                            {count}
                          </button>
                          <button
                            onClick={() => select(roofId)}
                            className="tabular-nums text-right opacity-80"
                          >
                            {fmtDe2.format(kWp || 0)}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="tabular-nums text-right opacity-80">
                            <RoofAreaInfo
                              points={l.points as Pt[]}
                              mpp={mpp}
                              variant="text"
                              showUnit={false}
                              tiltDeg={l.tiltDeg}
                              correctForTilt
                            />
                          </div>
                          <div className="flex justify-center px-0.5">
                            {editing?.id === roofId &&
                            editing.field === "tilt" ? (
                              <span className="flex h-7 w-[44px] items-center rounded-md border border-primary bg-background/70 px-1 ring-1 ring-primary/30">
                                <input
                                  autoFocus
                                  type="text"
                                  inputMode="decimal"
                                  value={tempVal}
                                  onChange={(e) => setTempVal(e.target.value)}
                                  onBlur={() => commitInline(roofId, "tilt")}
                                  data-stop-hotkeys="true"
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                      return;
                                    }
                                    if (e.key === "Escape") {
                                      setEditing(null);
                                      return;
                                    }
                                  }}
                                  aria-label={`Dachneigung für D${i + 1}`}
                                  className="min-w-0 flex-1 bg-transparent text-right text-[9px] tabular-nums outline-none"
                                />
                                <span className="text-[9px] text-muted-foreground">°</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={rowKind === "flat"}
                                onClick={() => openInlineEditor({
                                  roofId,
                                  field: "tilt",
                                  value: tiltShort,
                                  disabled: rowKind === "flat",
                                })}
                                title={rowKind === "flat" ? "Flachdach: Neigung 0°" : "Dachneigung bearbeiten"}
                                aria-label={`Dachneigung für D${i + 1} bearbeiten`}
                                className="flex h-7 w-[44px] items-center justify-center rounded-md border border-border/70 bg-muted/20 px-1 text-[9px] tabular-nums transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                {tiltShort != null ? `${tiltShort}°` : "—"}
                              </button>
                            )}
                          </div>

                          <div className="px-0.5">
                            {rowKind === "flat" ? (
                              <div
                                title="Geometrische Dachausrichtung"
                                className="flex h-7 w-full min-w-0 items-center justify-center truncate rounded-md border border-border/70 bg-muted/20 px-1 text-[9px] tabular-nums"
                              >
                                {geometricOrientation == null
                                  ? "—"
                                  : `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(geometricOrientation)}°`}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openInlineEditor({ roofId, field: "az", value: azShort })}
                                title="Gefällerichtung bearbeiten"
                                aria-label={`Ausrichtung für D${i + 1} bearbeiten`}
                                className="flex h-7 w-full min-w-0 items-center justify-center truncate rounded-md border border-border/70 bg-muted/20 px-1 text-[9px] tabular-nums transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                              >
                                {azShort != null
                                  ? `${roofAzimuthCardinal(azShort)} · ${azShort}°`
                                  : "Festlegen"}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-1">
                            {srcBadge && (
                              <span
                                className={[
                                  "inline-flex  h-[14px] min-w-[14px] items-center justify-center rounded-sm px-[4px] text-[9px]",
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-muted-foreground",
                                ].join(" ")}
                                title={
                                  srcBadge === "S" ? "Sonnendach" : "Manuell"
                                }
                              >
                                {srcBadge}
                              </span>
                            )}
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                delLayer(roofId);
                              }}
                              title="Dachfläche löschen"
                              aria-label={`Ebene löschen: ${l.name ?? `D${i + 1}`}`}
                              className={[
                                "text-[12px] leading-none",
                                active
                                  ? "opacity-90 hover:opacity-100"
                                  : "opacity-60 hover:opacity-100 hover:text-destructive",
                              ].join(" ")}
                            >
                              ✕
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    {step === "building" && editing?.id === roofId && editing.field === "az" && (
                      <div
                        className="space-y-2 border-x border-b border-primary/30 bg-background/80 p-2"
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setEditing(null);
                        }}
                      >
                        <label className="block text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                          Ausrichtung
                          <select
                            autoFocus
                            value={azimuthMode === "custom" ? "custom" : String(azShort)}
                            onChange={(event) => {
                              if (event.target.value === "custom") {
                                setAzimuthMode("custom");
                                const lastCustom = lastCustomAzimuthByRoofRef.current.get(roofId);
                                if (lastCustom != null) setTempVal(String(lastCustom));
                                return;
                              }
                              setAzimuthMode("preset");
                              commitInline(roofId, "az", event.target.value);
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === "Escape") setEditing(null);
                            }}
                            data-stop-hotkeys="true"
                            className="mt-1 h-8 w-full rounded-lg border border-border/70 bg-background/70 px-2 text-[10px] font-normal normal-case tracking-normal text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                          >
                            {ROOF_DIRECTION_CHOICES.map((choice) => (
                              <option key={choice.azimuthDeg} value={choice.azimuthDeg}>
                                {choice.label} · {choice.azimuthDeg}°
                              </option>
                            ))}
                            <option value="custom">Benutzerdefiniert…</option>
                          </select>
                        </label>
                        {azimuthMode === "custom" && (
                          <label className="block text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                            Exakter Winkel
                            <span className="mt-1 flex h-8 items-center rounded-lg border border-border/70 bg-background/70 px-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30">
                              <input
                                autoFocus
                                type="text"
                                inputMode="decimal"
                                value={tempVal}
                                onChange={(event) => setTempVal(event.target.value)}
                                onBlur={() => {
                                  const customValue = Number(tempVal.replace(",", "."));
                                  if (Number.isFinite(customValue)) {
                                    lastCustomAzimuthByRoofRef.current.set(
                                      roofId,
                                      normalizeRoofAzimuthDeg(customValue),
                                    );
                                  }
                                  commitInline(roofId, "az");
                                }}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === "Enter") event.currentTarget.blur();
                                  if (event.key === "Escape") setEditing(null);
                                }}
                                data-stop-hotkeys="true"
                                aria-label={`Exakter Ausrichtungswinkel für D${i + 1}`}
                                className="min-w-0 flex-1 bg-transparent text-[10px] font-normal normal-case tracking-normal text-foreground outline-none"
                              />
                              <span className="text-[10px] font-normal text-muted-foreground">°</span>
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {step === "building" && panels.length > 0 && (
        <button
          type="button"
          aria-pressed={showPanelsInBuilding}
          onClick={() =>
            setUI({ showPanelsInBuilding: !showPanelsInBuilding })
          }
          className="flex h-9 w-full items-center justify-between rounded-xl border border-border/70 bg-muted/15 px-3 text-[11px] font-medium text-foreground hover:bg-muted/30"
        >
          <span>Bestehende Module</span>
          <span className="flex items-center gap-1.5 text-primary">
            {showPanelsInBuilding ? (
              <Eye className="h-4 w-4" aria-hidden="true" />
            ) : (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            )}
            {showPanelsInBuilding ? "Sichtbar" : "Ausgeblendet"}
          </span>
        </button>
      )}

      {!selectedRoof && (
        <section className="rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-7 text-center">
          <MdViewModule
            className="mx-auto h-6 w-6 text-muted-foreground/70"
            aria-hidden="true"
          />
          <h2 className="mt-2 text-[12px] font-semibold">
            Dachfläche auswählen
          </h2>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {step === "building"
              ? "Klicke auf eine Dachfläche, um ihre Eigenschaften zu bearbeiten."
              : "Klicke auf eine Dachfläche, um Module zu planen."}
          </p>
        </section>
      )}

      {step === "building" && selectedRoof && (
        <section className="space-y-2 border-b border-border/60 pb-4">
          <label className={labelSm}>Dachtyp</label>
          <div
            className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1"
            role="group"
            aria-label="Dachtyp"
          >
            <button
              type="button"
              onClick={() => requestRoofTypeChange("pitched")}
              aria-pressed={customerRoofType === "pitched"}
              className={`h-11 rounded-lg text-[11px] font-semibold ${customerRoofType === "pitched" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Schrägdach
            </button>
            <button
              type="button"
              onClick={() => requestRoofTypeChange("flat")}
              disabled={!selSpec}
              aria-pressed={customerRoofType === "flat"}
              className={`h-11 rounded-lg text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${customerRoofType === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Flachdach
            </button>
          </div>
          {customerRoofType === "preserved-green" && (
            <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] text-muted-foreground">
              Die bestehende Gründach-Konfiguration bleibt gespeichert. Neue
              Gründach-Planungen sind in diesem Workflow derzeit ausgeblendet.
            </p>
          )}
          {displayMode === "advanced" && !advancedConfig && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
              Diese gespeicherte Flachdach-Konfiguration wird von dieser
              SOLA-Version nicht unterstützt. Die gespeicherten Module bleiben
              unverändert.
            </p>
          )}
        </section>
      )}

      {step === "building" && selectedRoof && (
        <RoofMarginControl roof={selectedRoof} />
      )}

      {step === "building" && selectedRoof && (
        <RoofDimensionsControl roof={selectedRoof} roofKind={selectedRoofKind} />
      )}

      {step === "building" && selectedRoof && (
        <ZonePropertiesControl roof={selectedRoof} roofKind={selectedRoofKind} />
      )}

      {step === "modules" &&
        selectedRoof &&
        customerRoofType === "flat" &&
        advancedConfig && (
          <AdvancedModulesPanel
            roof={selectedRoof}
            config={advancedConfig as AdvancedSurfacePlanningV1}
            activeMode={activeModuleMode === "south" || activeModuleMode === "east-west" ? activeModuleMode : undefined}
            onSelectMode={(mode) => requestModuleMode(mode)}
            isDraft={
              selectedDraft?.targetMode === "advanced" ||
              implicitFlatConfig !== undefined
            }
            previewEnabled={
              selectedDraft?.targetMode === "advanced"
                ? selectedDraft.previewEnabled !== false
                : false
            }
          />
        )}

      {step === "modules" && selectedRoof && displayMode === "standard" && (
        <div className="space-y-4">
          <section className="space-y-1">
            <label htmlFor="panel-select" className={labelSm}>
              Modul
            </label>
            <select
              id="panel-select"
              aria-label="Modul wählen"
              value={displayedPanelId}
              onChange={(event) => {
                setRoofPlanningDraft(selectedRoof.id, {
                  ...(standardDraft ?? createStandardPlanningDraft({
                    panelSpecId: displayedPanelId,
                    modules,
                    moduleTilt: displayedTiltInput,
                    thermalFieldLimits: displayedThermalLimits.kind === "pitched-grid" ? displayedThermalLimits : undefined,
                  })),
                  panelSpecId: event.target.value,
                });
              }}
              className={inputBase}
            >
              {catalogPanels.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  {panel.brand} {panel.model} — {panel.wp} W
                </option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <label className={labelSm}>Layout</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1">
              {(["portrait", "landscape"] as const).map((orientation) => (
                <button
                  key={orientation}
                  type="button"
                  onClick={() => requestModuleMode(orientation)}
                  aria-pressed={activeModuleMode === orientation}
                  className={`h-9 rounded-lg text-[10px] font-medium ${activeModuleMode === orientation ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {orientation === "portrait" ? "Hochformat" : "Querformat"}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2 border-b border-border/60 pb-4">
            <div className="flex items-center justify-between gap-2">
              <span className={labelSm}>Modulneigung</span>
              {displayedTilt.mode === "inherit-roof" && displayedTilt.effectiveTiltDeg !== undefined && (
                <span className="text-[10px] text-primary">
                  {Number(displayedTilt.effectiveTiltDeg.toFixed(2))}° · wie Dach
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={displayedTilt.mode === "inherit-roof"}
                disabled={displayedTilt.effectiveTiltDeg === undefined}
                onChange={(event) => {
                  if (event.target.checked) patchStandardTilt({ mode: "inherit-roof" });
                  else patchStandardTilt({
                    mode: "custom",
                    customTiltDeg: displayedTilt.effectiveTiltDeg ?? 0,
                  });
                }}
              />
              Dachneigung übernehmen
            </label>
            {displayedTilt.mode === "custom" && (
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <input
                  className={inputBase}
                  type="text"
                  inputMode="decimal"
                  value={moduleTiltText}
                  onChange={(event) => setModuleTiltText(event.target.value)}
                  onBlur={commitModuleTiltText}
                  onKeyDown={(event) => {
                    stopHotkeysCapture(event);
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label="Eigene Modulneigung"
                />
                <span>°</span>
              </label>
            )}
            {displayedTilt.effectiveTiltDeg === undefined && (
              <p className="text-[10px] text-amber-600">Dachneigung fehlt. Bitte zuerst in Gebäudeplanung eintragen.</p>
            )}
          </section>

          <section className="space-y-3 border-b border-border/60 pb-4">
            <h3 className={labelSm}>Ausrichtung</h3>
            <details className="rounded-xl border border-border/60 text-[10px]">
              <summary className="cursor-pointer px-3 py-2.5 font-medium text-muted-foreground">
                Feinjustierung
              </summary>
              <div className="space-y-3 border-t border-border/60 p-3">
                <DirectLayoutControl roofId={selectedRoof.id} />
              </div>
            </details>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={labelSm}>Modulabstand</span>
              <button
                type="button"
                onClick={() =>
                  patchDisplayedModules({
                    spacingM:
                      companyPlannerDefaults.moduleSpacing.horizontalMm / 1000,
                    spacingXM:
                      companyPlannerDefaults.moduleSpacing.horizontalMm / 1000,
                    spacingYM:
                      companyPlannerDefaults.moduleSpacing.verticalMm / 1000,
                  })
                }
                className="text-[9px] text-primary hover:underline"
                title={`Firmenstandard: ${companyPlannerDefaults.moduleSpacing.horizontalMm} / ${companyPlannerDefaults.moduleSpacing.verticalMm} mm`}
              >
                Firmenstandard
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[10px] text-muted-foreground">
              Horizontal
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={COMPANY_MODULE_SPACING_LIMITS_MM.max}
                  value={displayedSpacingXM * 1000}
                  onChange={(event) => {
                    const mm = Number(event.target.value);
                    if (!isValidModuleSpacingMm(mm)) return;
                    patchDisplayedModules({
                      spacingM: mm / 1000,
                      spacingXM: mm / 1000,
                    });
                  }}
                  className={inputBase}
                  aria-label="Modulabstand horizontal (mm)"
                />
                <span>mm</span>
              </span>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground">
              Vertikal
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={COMPANY_MODULE_SPACING_LIMITS_MM.max}
                  value={displayedSpacingYM * 1000}
                  onChange={(event) => {
                    const mm = Number(event.target.value);
                    if (!isValidModuleSpacingMm(mm)) return;
                    patchDisplayedModules({ spacingYM: mm / 1000 });
                  }}
                  className={inputBase}
                  aria-label="Modulabstand vertikal (mm)"
                />
                <span>mm</span>
              </span>
            </label>
            </div>
          </section>

          {standardDraft && (
            <section className="space-y-2 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
              <p>Konfiguration gewählt. Module werden erst mit U, F oder Einzelplatzierung erzeugt.</p>
              <button
                type="button"
                className="h-8 w-full rounded-lg border border-border text-[10px] text-foreground"
                onClick={() => clearRoofPlanningDraft(selectedRoof.id)}
              >
                Auswahl zurücksetzen
              </button>
            </section>
          )}
        </div>
      )}

      <RoofTypeChangeDialog
        open={pendingRoofType !== null}
        currentLabel={customerRoofType === "flat" ? "Flachdach" : "Schrägdach"}
        nextLabel={pendingRoofType === "flat" ? "Flachdach" : "Schrägdach"}
        moduleCount={
          selectedRoof
            ? panels.filter((panel) => panel.roofId === selectedRoof.id).length
            : 0
        }
        onCancel={() => setPendingRoofType(null)}
        onConfirm={confirmRoofTypeChange}
      />
    </div>
  );
}
