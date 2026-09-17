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
  type SurfacePlanningV1,
  type StandardModuleTiltInput,
  type ThermalFieldLimits,
} from "@/lib/planning-core/advanced";
import AdvancedModulesPanel from "../modules/advanced/AdvancedModulesPanel";
import RoofDimensionsControl from "./RoofDimensionsControl";
import RoofTypeChangeDialog from "./RoofTypeChangeDialog";
import LayoutModeChangeDialog from "./LayoutModeChangeDialog";
import RoofMarginControl from "./RoofMarginControl";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import {
  normalizeRoofAzimuthDeg,
  ROOF_DIRECTION_CHOICES,
  roofAzimuthCardinal,
} from "../roof/roofOrientation";
import { modulesWithRoofEdgeMargin } from "@/lib/planning/roofProperties";
import { resolveRoofGeometricOrientationDeg } from "@/lib/planning-core/geometry-v2";
import {
  isValidModuleSpacingMm,
  resolveCompanyFlatRoofSpacingDefaults,
  resolveCompanyThermalFieldLimits,
} from "@/lib/planning/companyPlannerDefaults";
import {
  createInitialAdvancedPlanning,
  buildStandardSurfacePlanning,
  createStandardPlanningDraft,
  resolveStandardTiltInput,
  resolveInitialSonnendachRoofType,
  resolveRoofPlanningMode,
  resolveRoofModuleMode,
  resolveModuleModeChangeIntent,
  setAdvancedMountingOrientation,
  updateDefaultFlatSystem,
  alignAdvancedLayoutParallelToRoofEdge,
} from "../modules/advanced/advancedPlanningApplication";
import ZonePropertiesControl from "../zones/ZonePropertiesControl";
import DirectLayoutControl from "../modules/panels/DirectLayoutControl";
import { endManualPlacement } from "../modules/manualPlacementSession";
import { history as plannerHistory } from "../state/history";
import { buildStandardExistingLayoutReflow } from "../modules/panels/existingLayoutReflow";
import { formatDisplayAngleDeg } from "../roof/angleDisplay";

type Pt = { x: number; y: number };

const inputBase =
  "glass-input h-8 w-full rounded-lg px-2 py-0 text-[11px] leading-none " +
  "focus:ring-1 focus:ring-primary/40 transition";

const labelSm =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

// Customer requested hiding the module-orientation readout from Modulplanung.
// Keep the dormant presentation path easy to restore; orientation state and
// all layout calculations remain active in the planner domain/application code.
const SHOW_MODULE_ORIENTATION_READOUT = false;

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
  const commitRoofLayout = usePlannerV2Store((s) => s.commitRoofLayout);
  const zones = usePlannerV2Store((s) => s.zones);
  const snowGuards = usePlannerV2Store((s) => s.snowGuards);
  const companyPlannerDefaults = usePlannerV2Store(
    (s) => s.companyPlannerDefaults,
  );
  const selSpec = usePlannerV2Store((s) => s.getSelectedPanel());
  const snapshot = usePlannerV2Store((s) => s.snapshot);

  // --- Catalogo PV (spostato qui dalla topbar) ---
  const catalogPanels = usePlannerV2Store((s) => s.catalogPanels);
  const selectedPanelId = usePlannerV2Store((s) => s.selectedPanelId);
  const setSelectedPanel = usePlannerV2Store((s) => s.setSelectedPanel);
  const roofPlanningDrafts = usePlannerV2Store((s) => s.roofPlanningDrafts);
  const setRoofPlanningDraft = usePlannerV2Store((s) => s.setRoofPlanningDraft);
  const clearRoofPlanningDraft = usePlannerV2Store((s) => s.clearRoofPlanningDraft);
  const confirmRoofKindChange = usePlannerV2Store((s) => s.confirmRoofKindChange);
  const confirmModuleModeChange = usePlannerV2Store((s) => s.confirmModuleModeChange);

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
  const [pendingLayoutMode, setPendingLayoutMode] = React.useState<
    "portrait" | "landscape" | "south" | "east-west" | null
  >(null);
  const [moduleTiltText, setModuleTiltText] = React.useState("");
  const [spacingXText, setSpacingXText] = React.useState("");
  const [spacingYText, setSpacingYText] = React.useState("");

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
    const initial = createInitialAdvancedPlanning({
      panel: selSpec,
      standardModules: modulesWithRoofEdgeMargin(selectedRoof, modules),
      thermalFieldLimits: limits.kind === "flat-block" ? limits : undefined,
    });
    const defaults = resolveCompanyFlatRoofSpacingDefaults({
      company: companyPlannerDefaults,
      orientation: "east-west",
    });
    return updateDefaultFlatSystem({
      config: initial,
      orientation: "east-west",
      rowSpaceM: defaults.rowSpaceM,
      serviceCorridorM: defaults.serviceCorridorM,
      moduleGapM: defaults.moduleGapMm / 1000,
      nominalTiltDeg: defaults.nominalTiltDeg,
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
  React.useEffect(() => {
    setSpacingXText(String(Math.round(displayedSpacingXM * 10000) / 10));
    setSpacingYText(String(Math.round(displayedSpacingYM * 10000) / 10));
  }, [displayedSpacingXM, displayedSpacingYM, selectedRoof?.id]);
  const commitStandardGeometry = React.useCallback((input: {
    nextModules?: typeof modules;
    moduleTilt?: StandardModuleTiltInput;
  }) => {
    if (!selectedRoof || !(snapshot.mppImage && snapshot.mppImage > 0)) return false;
    const nextModules = input.nextModules ?? modules;
    const persisted = resolveSurfacePlanning(selectedRoof.surfacePlanning);
    const moduleTilt: StandardModuleTiltInput = input.moduleTilt ?? ((
      persisted.status === "supported-standard"
        ? persisted.config.moduleTilt
        : displayedTiltInput
    ) ?? { mode: "inherit-roof" });
    const candidate = buildStandardExistingLayoutReflow({
      roof: selectedRoof,
      currentPanels: panels,
      previousModules: modules,
      nextModules,
      moduleTilt,
      thermalFieldLimits: displayedThermalLimits,
      mppImage: snapshot.mppImage,
      zones,
      snowGuards,
    });
    if (!candidate) {
      toast.error("Wert nicht übernommen: Die bestehende Belegung wäre ungültig.");
      return false;
    }
    plannerHistory.push("Abstände ändern");
    commitRoofLayout({
      roofId: selectedRoof.id,
      panels: candidate.panels,
      surfacePlanning: candidate.surfacePlanning,
      modules: candidate.modules,
    });
    return true;
  }, [commitRoofLayout, displayedThermalLimits, displayedTiltInput, modules, panels, selectedRoof, snapshot.mppImage, snowGuards, zones]);

  const commitStandardSpacing = React.useCallback((axis: "x" | "y") => {
    const text = axis === "x" ? spacingXText : spacingYText;
    const mm = Number(text.replace(",", "."));
    if (!isValidModuleSpacingMm(mm)) {
      if (axis === "x") setSpacingXText(String(Math.round(displayedSpacingXM * 10000) / 10));
      else setSpacingYText(String(Math.round(displayedSpacingYM * 10000) / 10));
      return false;
    }
    const metres = mm / 1000;
    const applied = commitStandardGeometry({
      nextModules: axis === "x"
        ? { ...modules, spacingM: metres, spacingXM: metres }
        : { ...modules, spacingYM: metres },
    });
    if (!applied) {
      if (axis === "x") setSpacingXText(String(Math.round(displayedSpacingXM * 10000) / 10));
      else setSpacingYText(String(Math.round(displayedSpacingYM * 10000) / 10));
    }
    return applied;
  }, [commitStandardGeometry, displayedSpacingXM, displayedSpacingYM, modules, spacingXText, spacingYText]);

  const patchStandardTilt = React.useCallback((moduleTilt: StandardModuleTiltInput) => {
    commitStandardGeometry({ moduleTilt });
  }, [commitStandardGeometry]);

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
    endManualPlacement();
    confirmRoofKindChange({
      roofId: selectedRoof.id,
      nextRoofKind: pendingRoofType,
    });
    setPendingRoofType(null);
    toast.success("Dachtyp geändert. Die Dachfläche kann neu geplant werden.");
  }, [confirmRoofKindChange, pendingRoofType, selectedRoof]);

  React.useEffect(() => {
    setPendingRoofType(null);
    setPendingLayoutMode(null);
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

  const buildRequestedModuleMode = useCallback((mode: "portrait" | "landscape" | "south" | "east-west"): {
    draft: Parameters<typeof setRoofPlanningDraft>[1];
    surfacePlanning: SurfacePlanningV1;
  } | undefined => {
    if (!selectedRoof) return undefined;
    if (mode === "portrait" || mode === "landscape") {
      const draft = standardDraft ?? createStandardPlanningDraft({
        panelSpecId: displayedPanelId,
        modules,
        moduleTilt: displayedTiltInput,
        thermalFieldLimits: displayedThermalLimits,
      });
      const nextDraft = {
        ...draft,
        previewEnabled: false,
        modules: { ...draft.modules, orientation: mode },
      };
      return {
        draft: nextDraft,
        surfacePlanning: buildStandardSurfacePlanning({
          roof: selectedRoof,
          moduleTilt: nextDraft.moduleTilt,
          moduleLayoutMode: mode,
          thermalFieldLimits: nextDraft.thermalFieldLimits,
        }),
      };
    }
    if (!selSpec) return undefined;
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
    if (!selectedAdvancedConfig) {
      const defaults = resolveCompanyFlatRoofSpacingDefaults({
        company: companyPlannerDefaults,
        orientation: mode,
      });
      config = updateDefaultFlatSystem({
        config,
        orientation: mode,
        rowSpaceM: defaults.rowSpaceM,
        serviceCorridorM: defaults.serviceCorridorM,
        moduleGapM: defaults.moduleGapMm / 1000,
        nominalTiltDeg: defaults.nominalTiltDeg,
      });
    }
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
    return {
      draft: {
        targetMode: "advanced",
        previewEnabled: false,
        config,
      },
      surfacePlanning: config,
    };
  }, [companyPlannerDefaults, displayedPanelId, displayedThermalLimits, displayedTiltInput, modules, selSpec, selectedAdvancedConfig, selectedRoof, snapshot.mppImage, standardDraft]);

  const requestModuleMode = useCallback((mode: "portrait" | "landscape" | "south" | "east-west") => {
    if (!selectedRoof || pendingLayoutMode) return;
    const intent = resolveModuleModeChangeIntent({
      currentMode: activeModuleMode,
      requestedMode: mode,
      committedPanelCount: panels.filter((panel) => panel.roofId === selectedRoof.id).length,
    });
    if (intent === "noop") return;
    if (intent === "confirm") {
      setPendingLayoutMode(mode);
      return;
    }
    const requested = buildRequestedModuleMode(mode);
    if (!requested) return;
    setRoofPlanningDraft(selectedRoof.id, requested.draft);
  }, [activeModuleMode, buildRequestedModuleMode, panels, pendingLayoutMode, selectedRoof, setRoofPlanningDraft]);

  const confirmLayoutModeChange = React.useCallback(() => {
    if (!selectedRoof || !pendingLayoutMode) return;
    const requested = buildRequestedModuleMode(pendingLayoutMode);
    if (!requested) return;
    endManualPlacement();
    confirmModuleModeChange({
      roofId: selectedRoof.id,
      nextSurfacePlanning: requested.surfacePlanning,
    });
    setPendingLayoutMode(null);
    toast.success("Ausrichtung geändert. Die Dachfläche kann neu belegt werden.");
  }, [buildRequestedModuleMode, confirmModuleModeChange, pendingLayoutMode, selectedRoof]);

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
            <div
              data-roof-list-header
              className="grid h-8 grid-cols-[28px_42px_48px_minmax(70px,1fr)_32px] items-end px-1 pb-1 text-[8px] font-medium leading-none text-muted-foreground"
            >
              <div>Dach</div>
              <div className="text-right">Fläche</div>
              <div className="text-center">Neigung</div>
              <div className="text-center">Ausrichtung</div>
              <div />
            </div>

            {/* Righe (monolinea) */}
            <ul className="divide-y divide-border/70">
              {layers.map((l, i) => {
                const roofId = l.id;
                const active = selectedId === roofId;

                const rowPlanning = resolveSurfacePlanning(l.surfacePlanning);
                const rowKind = l.roofKind ?? (
                  rowPlanning.status === "supported-advanced" || rowPlanning.status === "supported-standard"
                    ? rowPlanning.config.surface.kind
                    : resolveInitialSonnendachRoofType(l) ?? "pitched"
                );
                const az = rowPlanning.status === "supported-advanced"
                  ? rowPlanning.config.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(l)
                  : resolveRoofFallAzimuth(l);
                const tilt = rowKind === "flat"
                  ? 0
                  : rowPlanning.status === "supported-advanced"
                    ? rowPlanning.config.surface.slopeDeg ?? l.tiltDeg
                    : l.tiltDeg;
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
                      data-roof-list-row
                      className={[
                        "grid min-h-9 grid-cols-[28px_42px_48px_minmax(70px,1fr)_32px] items-center px-1",
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
                      </button>

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
                        {step === "building" ? (
                          editing?.id === roofId &&
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
                            )
                        ) : (
                          <div className="flex h-7 w-[44px] items-center justify-center rounded-md border border-border/70 bg-muted/20 px-1 text-[9px] tabular-nums">
                            {tiltShort != null ? `${tiltShort}°` : "—"}
                          </div>
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
                              : formatDisplayAngleDeg(geometricOrientation)}
                          </div>
                        ) : step === "building" ? (
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
                        ) : (
                          <div className="flex h-7 w-full min-w-0 items-center justify-center truncate rounded-md border border-border/70 bg-muted/20 px-1 text-[9px] tabular-nums">
                            {azShort != null
                              ? `${roofAzimuthCardinal(azShort)} · ${azShort}°`
                              : "Festlegen"}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-1">
                        {srcBadge && (
                          <span
                            className={[
                              "inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-sm px-[4px] text-[9px]",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-muted-foreground",
                            ].join(" ")}
                            title={srcBadge === "S" ? "Sonnendach" : "Manuell"}
                          >
                            {srcBadge}
                          </span>
                        )}
                        {step === "building" && (
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
                        )}
                      </div>
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

      {step === "building" && !selectedRoof && (
        <section className="rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-7 text-center">
          <MdViewModule
            className="mx-auto h-6 w-6 text-muted-foreground/70"
            aria-hidden="true"
          />
          <h2 className="mt-2 text-[12px] font-semibold">
            Dachfläche auswählen
          </h2>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Klicke auf eine Dachfläche, um ihre Eigenschaften zu bearbeiten.
          </p>
        </section>
      )}

      {step === "modules" && !selectedRoof && (
        <div
          className="space-y-4"
          data-testid="module-planning-neutral-shell"
        >
          <section className="space-y-2 border-b border-border/60 pb-4">
            <label className={labelSm}>Layout</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1">
              <button type="button" disabled className="h-9 rounded-lg text-[10px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60">
                Hochformat
              </button>
              <button type="button" disabled className="h-9 rounded-lg text-[10px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60">
                Querformat
              </button>
            </div>
          </section>

          <section className="space-y-1 border-b border-border/60 pb-4">
            <label htmlFor="panel-select-no-roof" className={labelSm}>Modul</label>
            <select
              id="panel-select-no-roof"
              aria-label="Modul wählen"
              value={selectedPanelId ?? ""}
              onChange={(event) => setSelectedPanel(event.target.value)}
              className={inputBase}
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
                <h3 className={labelSm}>Ausrichtung</h3>
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-3 py-2 text-[10px]">
                  <span className="text-muted-foreground">Modulausrichtung</span>
                  <strong aria-label="Keine Dachfläche ausgewählt">—</strong>
                </div>
              </>
            )}
            <div className="rounded-xl border border-border/60 text-[10px]">
              <div className="px-3 py-2.5 font-medium uppercase tracking-wide text-muted-foreground">
                Feinjustierung
              </div>
              <fieldset disabled className="space-y-2 border-t border-border/60 p-3">
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>Verschieben</span>
                  <div className="flex gap-1">
                    {(["←", "↑", "↓", "→"] as const).map((direction) => (
                      <button key={direction} type="button" className="h-7 w-7 rounded-md border border-border/70 bg-muted/15 disabled:cursor-not-allowed disabled:opacity-60">
                        {direction}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>Drehung</span>
                  <button type="button" className="h-7 rounded-md border border-border/70 bg-muted/15 px-3 disabled:cursor-not-allowed disabled:opacity-60">
                    —
                  </button>
                </div>
              </fieldset>
            </div>
          </section>

          <section className="space-y-2 border-b border-border/60 pb-4">
            <div className="flex items-center justify-between gap-2">
              <span className={labelSm}>Modulabstand</span>
              <span className="text-[9px] text-muted-foreground">Firmenstandard</span>
            </div>
            <fieldset disabled className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Horizontal
                <span className="flex items-center gap-1">
                  <input className={`${inputBase} disabled:cursor-not-allowed disabled:opacity-65`} value={companyPlannerDefaults.moduleSpacing.horizontalMm} readOnly />
                  <span>mm</span>
                </span>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Vertikal
                <span className="flex items-center gap-1">
                  <input className={`${inputBase} disabled:cursor-not-allowed disabled:opacity-65`} value={companyPlannerDefaults.moduleSpacing.verticalMm} readOnly />
                  <span>mm</span>
                </span>
              </label>
            </fieldset>
          </section>

          <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
            Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
          </p>
        </div>
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
            <div className="flex items-center justify-between gap-2">
              <label className={labelSm}>Layout</label>
              {standardDraft && (
                <button
                  type="button"
                  className="text-[9px] text-primary hover:underline"
                  onClick={() => clearRoofPlanningDraft(selectedRoof.id)}
                >
                  Auswahl zurücksetzen
                </button>
              )}
            </div>
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
            {SHOW_MODULE_ORIENTATION_READOUT && (
              <h3 className={labelSm}>Ausrichtung</h3>
            )}
            <div className="rounded-xl border border-border/60 text-[10px]">
              <div className="px-3 py-2.5 font-medium uppercase tracking-wide text-muted-foreground">
                Feinjustierung
              </div>
              <div className="space-y-3 border-t border-border/60 p-3">
                <DirectLayoutControl roofId={selectedRoof.id} />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={labelSm}>Modulabstand</span>
              <button
                type="button"
                onClick={() =>
                  commitStandardGeometry({
                    nextModules: {
                      ...modules,
                      spacingM: companyPlannerDefaults.moduleSpacing.horizontalMm / 1000,
                      spacingXM: companyPlannerDefaults.moduleSpacing.horizontalMm / 1000,
                      spacingYM: companyPlannerDefaults.moduleSpacing.verticalMm / 1000,
                    },
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
                  type="text"
                  inputMode="decimal"
                  value={spacingXText}
                  onChange={(event) => setSpacingXText(event.target.value)}
                  onBlur={() => commitStandardSpacing("x")}
                  onKeyDown={(event) => {
                    stopHotkeysCapture(event);
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSpacingXText(String(Math.round(displayedSpacingXM * 10000) / 10));
                      event.currentTarget.blur();
                    }
                  }}
                  className={`${inputBase} appearance-none [MozAppearance:textfield]`}
                  aria-label="Modulabstand horizontal (mm)"
                />
                <span>mm</span>
              </span>
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground">
              Vertikal
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={spacingYText}
                  onChange={(event) => setSpacingYText(event.target.value)}
                  onBlur={() => commitStandardSpacing("y")}
                  onKeyDown={(event) => {
                    stopHotkeysCapture(event);
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSpacingYText(String(Math.round(displayedSpacingYM * 10000) / 10));
                      event.currentTarget.blur();
                    }
                  }}
                  className={`${inputBase} appearance-none [MozAppearance:textfield]`}
                  aria-label="Modulabstand vertikal (mm)"
                />
                <span>mm</span>
              </span>
            </label>
            </div>
          </section>

          <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
            Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
          </p>

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
      <LayoutModeChangeDialog
        open={pendingLayoutMode !== null}
        roofLabel={selectedRoof ? `D${layers.findIndex((roof) => roof.id === selectedRoof.id) + 1}` : undefined}
        moduleCount={selectedRoof ? panels.filter((panel) => panel.roofId === selectedRoof.id).length : 0}
        onCancel={() => setPendingLayoutMode(null)}
        onConfirm={confirmLayoutModeChange}
      />
    </div>
  );
}
