// src/components_v2/modules/ModulesPanel.tsx
"use client";

import React, { useCallback } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import RoofAreaInfo from "../ui/RoofAreaInfo";
import DetectedRoofsImport from "../panels/DetectedRoofsImport";
import { MdViewModule } from "react-icons/md";
import OrientationToggle from "../layout/TopToolbar/OrientationToggle";
import { LuCompass } from "react-icons/lu";
import { Eye, EyeOff } from "lucide-react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";

import { computeLegacyStandardLayout } from "@/lib/planning-core/legacy-standard";
import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutCommitAction,
  orderStandardAutoLayoutPlacements,
  resolveStandardAutoLayoutSpacingAxes,
  selectLegacyStandardObstacles,
  STANDARD_AUTO_LAYOUT_POLICY,
} from "../modules/legacyStandardApplicationPolicy";
import GridRotationControl from "../modules/GridRotationControl";
import {
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import AdvancedModulesPanel from "../modules/advanced/AdvancedModulesPanel";
import RoofDimensionsControl from "./RoofDimensionsControl";
import RoofTypeChangeDialog from "./RoofTypeChangeDialog";
import PitchedRoofSlopeControl from "./PitchedRoofSlopeControl";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import { modulesWithRoofEdgeMargin, resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import { resolveRoofReferenceEdgeIndex } from "@/lib/planning-core/geometry-v2";
import {
  COMPANY_MODULE_SPACING_LIMITS_MM,
  isValidModuleSpacingMm,
} from "@/lib/planning/companyPlannerDefaults";
import {
  createInitialAdvancedPlanning,
  computeStandardDraftPanels,
  hasCommittedPanelsForRoof,
  resolveRoofPlanningMode,
} from "../modules/advanced/advancedPlanningApplication";

type Pt = { x: number; y: number };

const inputBase =
  "glass-input h-8 w-full rounded-lg px-2 py-0 text-[11px] leading-none " +
  "focus:ring-1 focus:ring-primary/40 transition";

const labelSm =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

// Piccola icona "tilt": triangolo + arco di angolo
function IconTilt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {/* triangolo (stroke corrente) */}
      <path
        d="M4 18 L18 18 L18 4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* arco dell’angolo in basso a sinistra */}
      <path
        d="M6 18 A2 2 0 0 1 8 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  const addPanelsForRoof = usePlannerV2Store((s) => s.addPanelsForRoof);
  const clearPanelsForRoof = usePlannerV2Store((s) => s.clearPanelsForRoof);

  // --- Catalogo PV (spostato qui dalla topbar) ---
  const catalogPanels = usePlannerV2Store((s) => s.catalogPanels);
  const selectedPanelId = usePlannerV2Store((s) => s.selectedPanelId);
  const setSelectedPanel = usePlannerV2Store((s) => s.setSelectedPanel);
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
  const [confirmStandardReplace, setConfirmStandardReplace] =
    React.useState(false);
  const [pendingRoofType, setPendingRoofType] = React.useState<
    "pitched" | "flat" | null
  >(null);
  const relayoutRef = React.useRef<
    null | ((next?: "portrait" | "landscape") => void)
  >(null);

  const selectedRoof = React.useMemo(
    () => layers.find((roof) => roof.id === selectedId),
    [layers, selectedId],
  );
  const selectedDraft = selectedId ? roofPlanningDrafts[selectedId] : undefined;
  const persistedPlanning = resolveSurfacePlanning(
    selectedRoof?.surfacePlanning,
  );
  const displayMode = resolveRoofPlanningMode({
    persisted: selectedRoof?.surfacePlanning,
    draft: selectedDraft,
  });
  const advancedConfig =
    selectedDraft?.targetMode === "advanced"
      ? selectedDraft.config
      : persistedPlanning.status === "supported-advanced"
        ? persistedPlanning.config
        : undefined;
  const standardDraft =
    selectedDraft?.targetMode === "standard" ? selectedDraft : undefined;
  const displayedModules = standardDraft?.modules ?? modules;
  const displayedSpacingXM =
    displayedModules.spacingXM ?? displayedModules.spacingM;
  const displayedSpacingYM =
    displayedModules.spacingYM ?? displayedModules.spacingM;
  const displayedPanelId = standardDraft?.panelSpecId ?? selectedPanelId;
  const customerRoofType =
    displayMode === "standard"
      ? "pitched"
      : advancedConfig?.surface.kind === "flat"
        ? "flat"
        : "preserved-green";
  const selectedRoofKind = customerRoofType === "pitched"
    ? "pitched"
    : customerRoofType === "flat"
      ? "flat"
      : "green";
  const patchDisplayedModules = React.useCallback(
    (patch: Partial<typeof modules>) => {
      if (selectedRoof && standardDraft) {
        setRoofPlanningDraft(selectedRoof.id, {
          ...standardDraft,
          modules: { ...standardDraft.modules, ...patch },
        });
        setConfirmStandardReplace(false);
        return;
      }
      setModules(patch);
    },
    [selectedRoof, setModules, setRoofPlanningDraft, standardDraft],
  );

  const applyStandardDraft = React.useCallback(() => {
    if (!selectedRoof || !standardDraft) return;
    const panel = catalogPanels.find(
      (item) => item.id === standardDraft.panelSpecId,
    );
    if (!panel || !snapshot.mppImage) return;
    const current = usePlannerV2Store.getState();
    const runId = nanoid();
    const nextPanels = computeStandardDraftPanels({
      roof: selectedRoof,
      panel,
      modules: standardDraft.modules,
      mppImage: snapshot.mppImage,
      zones: current.zones,
      snowGuards: current.snowGuards,
      createPanelId: (index) => `${selectedRoof.id}_p_${runId}_${index}`,
    });
    if (!nextPanels.length) return;
    commitRoofLayout({
      roofId: selectedRoof.id,
      panels: nextPanels,
      surfacePlanning: undefined,
    });
    setSelectedPanel(panel.id);
    setModules(standardDraft.modules);
    setConfirmStandardReplace(false);
    toast.success("Layout angewendet");
  }, [
    catalogPanels,
    commitRoofLayout,
    selectedRoof,
    setModules,
    setSelectedPanel,
    snapshot.mppImage,
    standardDraft,
  ]);

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

    if (pendingRoofType === "flat") {
      if (!selSpec) return;
      const nextConfig = createInitialAdvancedPlanning({
        panel: selSpec,
        standardModules: modulesWithRoofEdgeMargin(selectedRoof, modules),
      });
      commitRoofLayout({
        roofId: selectedRoof.id,
        panels: [],
        surfacePlanning: nextConfig,
      });
      updateRoof(selectedRoof.id, {
        referenceEdgeIndex: resolveRoofReferenceEdgeIndex({
          points: selectedRoof.points,
          roofKind: "flat",
        }),
      });
    } else {
      commitRoofLayout({
        roofId: selectedRoof.id,
        panels: [],
        surfacePlanning: undefined,
      });
      updateRoof(selectedRoof.id, { referenceEdgeIndex: 0 });
    }

    setPendingRoofType(null);
    setConfirmStandardReplace(false);
    toast.success("Dachtyp geändert. Die Dachfläche kann neu geplant werden.");
  }, [commitRoofLayout, modules, pendingRoofType, selSpec, selectedRoof, updateRoof]);

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
    (roofId: string, field: "tilt" | "az") => {
      const raw = Number(tempVal);
      if (!Number.isFinite(raw)) {
        setEditing(null);
        return;
      }

      if (field === "tilt") {
        const v = Math.max(0, Math.min(60, raw));
        updateRoof(roofId, { tiltDeg: v, source: "manual" });
      } else {
        const display = Math.round(raw); // valore inserito in UI (0° = N)
        const stored = ((display % 360) + 360) % 360;
        updateRoof(roofId, { fallAzimuthDeg: stored });
      }

      setEditing(null);
      if (selectedId === roofId) relayoutRef.current?.(); // ← usa la ref
    },
    [tempVal, updateRoof, selectedId],
  ); // ← rimosso relayoutSelectedRoof

  /** Re-layout immediato della falda selezionata (usato dal toggle orientamento) */
  const relayoutSelectedRoof = useCallback(
    (nextOrientation?: "portrait" | "landscape") => {
      if (!selectedId || !selSpec || !snapshot?.mppImage) return;

      const roof = layers.find((l) => l.id === selectedId);
      if (!roof?.points?.length) return;

      const canvasAngleDeg = resolveStandardAutoLayoutCanvasAngle({
        roofId: selectedId,
        roofPolygon: roof.points,
        legacyRoofAzimuthDeg: roof.azimuthDeg,
        gridAngleDeg: modules.gridAngleDeg,
        perRoofAngles: modules.perRoofAngles,
        referenceEdgeIndex: roof.referenceEdgeIndex,
      });

      const spacing = resolveStandardAutoLayoutSpacingAxes({
        spacingM: modules.spacingM,
        spacingXM: modules.spacingXM,
        spacingYM: modules.spacingYM,
      });
      const orientation = (nextOrientation ?? modules.orientation) as
        "portrait" | "landscape";

      const currentState = usePlannerV2Store.getState();
      const obstacles = selectLegacyStandardObstacles(
        currentState.zones,
        currentState.snowGuards,
        selectedId,
      );
      const layout = computeLegacyStandardLayout({
        generation: {
          roofPolygon: roof.points,
          mppImage: snapshot.mppImage,
          canvasAngleDeg,
          orientation,
          panelSizeM: { widthM: selSpec.widthM, heightM: selSpec.heightM },
          spacingM: spacing.x,
          spacingXM: spacing.x,
          spacingYM: spacing.y,
          marginM: resolveRoofEdgeMarginM(roof, modules.marginM),
          phaseX: modules.gridPhaseX ?? 0,
          phaseY: modules.gridPhaseY ?? 0,
          anchorX: modules.gridAnchorX ?? "start",
          anchorY: modules.gridAnchorY ?? "start",
          coverageRatio: modules.coverageRatio ?? 1,
        },
        reservedZones: obstacles.reservedZones,
        snowGuards: obstacles.snowGuards,
        filterPolicy: STANDARD_AUTO_LAYOUT_POLICY.filterPolicy,
      });

      const commitAction = resolveStandardAutoLayoutCommitAction(layout.count);
      if (commitAction === "preserve") return;

      // sostituisci i pannelli esistenti con i nuovi
      clearPanelsForRoof(selectedId);
      const now = Date.now().toString(36);
      const orderedPlacements = orderStandardAutoLayoutPlacements(
        layout.placements,
        {
          roofPolygon: roof.points,
          referenceEdgeIndex: roof.referenceEdgeIndex,
          fallAzimuthDeg: resolveRoofFallAzimuth(roof),
        },
      );
      const instances = orderedPlacements.map((r, idx) => ({
        id: `${selectedId}_p_${now}_${idx}`,
        roofId: selectedId,
        cx: r.cx,
        cy: r.cy,
        wPx: r.wPx,
        hPx: r.hPx,
        angleDeg: r.angleDeg,
        orientation,
        panelId: selSpec.id,
      }));
      addPanelsForRoof(selectedId, instances);
    },
    [
      selectedId,
      selSpec,
      snapshot?.mppImage,
      layers,
      modules.gridAngleDeg,
      modules.perRoofAngles,
      modules.marginM,
      modules.gridPhaseX,
      modules.gridPhaseY,
      modules.gridAnchorX,
      modules.gridAnchorY,
      modules.coverageRatio,
      modules.spacingM,
      modules.spacingXM,
      modules.spacingYM,
      modules.orientation,
      addPanelsForRoof,
      clearPanelsForRoof,
    ],
  );

  React.useEffect(() => {
    relayoutRef.current = relayoutSelectedRoof;
  }, [relayoutSelectedRoof]);

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
              <div className="grid h-6 grid-cols-[28px_52px_38px_58px_32px] items-center px-1 text-[10px] text-muted-foreground">
                <div className="font-medium">D</div>
                <div className="text-right font-medium">m²</div>
                <div
                  className="flex items-center justify-center"
                  title="Neigung (°)"
                >
                  <IconTilt className="h-3.5 w-3.5 opacity-90" />
                </div>
                <div
                  className="flex items-center justify-center"
                  title="Ausrichtung (° vs N)"
                >
                  <LuCompass className="h-4 w-4 opacity-90" />
                </div>
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

                // helpers compatti
                const norm360 = (d: number) => ((d % 360) + 360) % 360;
                const toCard8 = (az: number) =>
                  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
                    Math.round(norm360(az) / 45) % 8
                  ];
                const fmtDe2 = new Intl.NumberFormat("de-DE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });

                const az =
                  resolveRoofFallAzimuth(l);
                const tilt = typeof l.tiltDeg === "number" ? l.tiltDeg : undefined;

                const tiltShort = tilt != null ? Math.round(tilt) : undefined;

                const azView = az;
                const azShort = azView != null ? Math.round(azView) : undefined; // <-- ricalcola qui

                const src = l.source;
                const srcBadge =
                  src === "sonnendach" ? "S" : src === "manual" ? "M" : "";
                return (
                  <li key={roofId}>
                    <div
                      className={[
                        step === "building"
                          ? "grid h-8 grid-cols-[28px_52px_38px_58px_32px] items-center px-1"
                          : "grid h-8 grid-cols-[1fr_58px_70px] items-center px-1",
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
                        className="text-left font-semibold cursor-pointer"
                      >
                        {`D${i + 1}`}
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
                          <div
                            className="tabular-nums text-center opacity-80"
                            title="Neigung (°)"
                            onClick={() => {
                              if (
                                editing?.id === roofId &&
                                editing.field === "tilt"
                              )
                                return;
                              setEditing({ id: roofId, field: "tilt" });
                              setTempVal(
                                tiltShort != null ? String(tiltShort) : "",
                              );
                            }}
                          >
                            {editing?.id === roofId &&
                            editing.field === "tilt" ? (
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                max={60}
                                step={1}
                                value={tempVal}
                                onChange={(e) => setTempVal(e.target.value)}
                                onBlur={() => commitInline(roofId, "tilt")}
                                data-stop-hotkeys="true"
                                onKeyDownCapture={stopHotkeysCapture} // ⬅️ blocca i listener globali
                                onKeyDown={(e) => {
                                  // gestiamo noi i tasti principali
                                  if (e.key === "Enter") {
                                    commitInline(roofId, "tilt");
                                    return;
                                  }
                                  if (e.key === "Escape") {
                                    setEditing(null);
                                    return;
                                  }
                                  // Delete / Backspace: svuota il campo ma NON propagare
                                  if (
                                    e.key === "Delete" ||
                                    e.key === "Backspace"
                                  ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (e.nativeEvent?.stopImmediatePropagation)
                                      e.nativeEvent.stopImmediatePropagation();
                                    setTempVal("");
                                    return;
                                  }
                                }}
                                className="w-full h-5 text-[10px] text-center bg-transparent outline-none border-b border-current/30"
                                style={{ padding: 0 }}
                              />
                            ) : (
                              <span>
                                {tiltShort != null ? `${tiltShort}°` : "—"}
                              </span>
                            )}
                          </div>

                          <div
                            className="tabular-nums text-center opacity-80"
                            title={
                              azView != null
                                ? `${Math.round(azView)}° ${toCard8(azView)}`
                                : "Ausrichtung"
                            }
                            onClick={() => {
                              if (
                                editing?.id === roofId &&
                                editing.field === "az"
                              )
                                return;
                              setEditing({ id: roofId, field: "az" });
                              setTempVal(
                                azShort != null ? String(azShort) : "",
                              );
                            }}
                          >
                            {editing?.id === roofId &&
                            editing.field === "az" ? (
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                max={359}
                                step={1}
                                value={tempVal}
                                onChange={(e) => setTempVal(e.target.value)}
                                onBlur={() => commitInline(roofId, "az")}
                                data-stop-hotkeys="true"
                                onKeyDownCapture={stopHotkeysCapture} // ⬅️ blocca i listener globali
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    commitInline(roofId, "az");
                                    return;
                                  }
                                  if (e.key === "Escape") {
                                    setEditing(null);
                                    return;
                                  }
                                  if (
                                    e.key === "Delete" ||
                                    e.key === "Backspace"
                                  ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (e.nativeEvent?.stopImmediatePropagation)
                                      e.nativeEvent.stopImmediatePropagation();
                                    setTempVal("");
                                    return;
                                  }
                                }}
                                className="w-full h-5 text-[10px] text-center bg-transparent outline-none border-b border-current/30"
                                style={{ padding: 0 }}
                              />
                            ) : (
                              <span>
                                {azShort != null
                                  ? `${toCard8(azShort)} ${azShort}°`
                                  : "—"}
                              </span>
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
                              onClick={() => delLayer(roofId)}
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
        <PitchedRoofSlopeControl roof={selectedRoof} roofKind={selectedRoofKind} />
      )}

      {step === "building" && selectedRoof && (
        <RoofDimensionsControl roof={selectedRoof} roofKind={selectedRoofKind} />
      )}

      {step === "modules" &&
        selectedRoof &&
        customerRoofType === "flat" &&
        advancedConfig && (
          <AdvancedModulesPanel
            roof={selectedRoof}
            config={advancedConfig as AdvancedSurfacePlanningV1}
            isDraft={selectedDraft?.targetMode === "advanced"}
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
                if (standardDraft) {
                  setRoofPlanningDraft(selectedRoof.id, {
                    ...standardDraft,
                    panelSpecId: event.target.value,
                  });
                  setConfirmStandardReplace(false);
                } else {
                  setSelectedPanel(event.target.value);
                }
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
            {standardDraft ? (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1">
                {(["portrait", "landscape"] as const).map((orientation) => (
                  <button
                    key={orientation}
                    type="button"
                    onClick={() => patchDisplayedModules({ orientation })}
                    className={`h-9 rounded-lg text-[10px] font-medium ${displayedModules.orientation === orientation ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {orientation === "portrait" ? "Hochformat" : "Querformat"}
                  </button>
                ))}
              </div>
            ) : (
              <OrientationToggle
                onChange={(next) => relayoutSelectedRoof(next)}
              />
            )}
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

          <details className="rounded-xl border border-border/60 text-[10px]">
            <summary className="cursor-pointer px-3 py-2.5 font-medium text-muted-foreground">
              Feinjustierung
            </summary>
            <div className="border-t border-border/60 p-3">
              {!standardDraft ? (
                <GridRotationControl />
              ) : (
                <p className="text-muted-foreground">
                  Die technische Rasterausrichtung bleibt beim bestehenden
                  Standard-Layout unverändert.
                </p>
              )}
            </div>
          </details>

          {standardDraft && (
            <section className="sticky bottom-0 -mx-2 space-y-2 border-y border-primary/25 bg-background/95 p-3 backdrop-blur">
              <p className="text-[11px] font-semibold text-primary">
                Standard-Layout Vorschau
              </p>
              {confirmStandardReplace && (
                <p className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-2 text-[10px]">
                  Das bestehende Layout dieser Dachfläche wird ersetzt. Andere
                  Dachflächen bleiben unverändert.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Nicht angewendete Änderungen
              </p>
              <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
                <button
                  type="button"
                  className="h-9 rounded-lg border border-border text-[11px]"
                  onClick={() => {
                    clearRoofPlanningDraft(selectedRoof.id);
                    setConfirmStandardReplace(false);
                  }}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="h-9 rounded-lg bg-primary text-[11px] font-medium text-primary-foreground"
                  onClick={() => {
                    if (
                      hasCommittedPanelsForRoof(panels, selectedRoof.id) &&
                      !confirmStandardReplace
                    )
                      setConfirmStandardReplace(true);
                    else applyStandardDraft();
                  }}
                >
                  {confirmStandardReplace
                    ? "Ersetzen bestätigen"
                    : "Layout anwenden"}
                </button>
              </div>
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
