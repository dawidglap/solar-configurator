"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { history } from "../state/history";
import OrientationToggle from "./TopToolbar/OrientationToggle";
import toast from "react-hot-toast";
import { SnowGuardCostDialog, SnowSegment } from "../SnowGuardCostDialog";
import { useSearchParams, useRouter } from "next/navigation";
import { savePlannerToDb } from "../state/planning/savePlanning";

import { CircleHelp, MousePointer, RotateCcw, RotateCw, Ruler, Square } from "lucide-react";

// NUOVE icone topbar (1–10) da react-icons
import { TbShape3, TbDropletHalf2Filled } from "react-icons/tb";
import { MdAddBox, MdOutlineTexture, MdViewModule, MdBorderStyle } from "react-icons/md";
import { AiOutlineBorderHorizontal } from "react-icons/ai";
import { LuSnowflake, LuShapes } from "react-icons/lu";
import { FaRegTrashAlt } from "react-icons/fa";
import { IoIosSave } from "react-icons/io";

import {
  computeLegacyStandardLayout,
} from "@/lib/planning-core/legacy-standard";
import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutCommitAction,
  orderStandardAutoLayoutPlacements,
  resolveStandardAutoLayoutSpacingAxes,
  selectLegacyStandardObstacles,
  STANDARD_AUTO_LAYOUT_POLICY,
} from "../modules/legacyStandardApplicationPolicy";

import ProjectStatsBar from "../ui/ProjectStatsBar";
import TopbarAddressSearch from "./TopbarAddressSearch";
import PlannerHelpDialog from "./PlannerHelpDialog";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import {
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "@/lib/planning-core/advanced";
import {
  beginManualPlacement,
  endManualPlacement,
  useManualPlacementSession,
} from "../modules/manualPlacementSession";
import {
  buildStandardPanelMetadata,
  buildStandardSurfacePlanning,
  resolveStandardTiltInput,
} from "../modules/advanced/advancedPlanningApplication";

/* ───────────────────── Keycaps ───────────────────── */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-[20px] z-[101] items-center justify-center rounded-[6px] border border-border bg-secondary px-1 text-[10px] font-medium leading-none text-foreground shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_1px_6px_rgba(0,0,0,0.4)]">
      {children}
    </span>
  );
}

/* ───────────────────── Tooltip in Portal ───────────────────── */
type TooltipPos = { x: number; y: number };

function PortalTooltip({
  visible,
  pos,
  label,
  keys,
}: {
  visible: boolean;
  pos: TooltipPos | null;
  label: string;
  keys: (string | React.ReactNode)[];
}) {
  if (typeof window === "undefined") return null;
  if (!visible || !pos) return null;
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, 0)",
        zIndex: 100000,
        pointerEvents: "none",
      }}
      className="glass-panel-elevated rounded-md px-2.5 py-2 text-xs text-foreground shadow-xl whitespace-nowrap"
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex items-center justify-center gap-1">
        {keys.map((k, i) => (
          <Keycap key={i}>{k}</Keycap>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Accetta sia RefObject che MutableRefObject */
type AnyRef<T extends HTMLElement> =
  | React.RefObject<T>
  | React.MutableRefObject<T | null>;
function useBottomTooltip<T extends HTMLElement>(triggerRef: AnyRef<T>) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const compute = () => {
    const el = triggerRef.current as T | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
  };
  const show = () => {
    compute();
    setVisible(true);
  };
  const hide = () => setVisible(false);
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => compute();
    const onResize = () => compute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible]);
  return { visible, pos, show, hide };
}

/* ───────────────────────── Toolbar ───────────────────────── */
export default function TopToolbar() {
  // Stato globale
  const step = usePlannerV2Store((s) => s.step); // 'building' | 'modules' | ...
  const setStep = usePlannerV2Store((s) => s.setStep);
  const tool = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);
  const sp = useSearchParams();
  const router = useRouter();
  const planningId = sp.get("planningId");

  // catalogo moduli (TopToolbar)
  const catalogPanels = usePlannerV2Store((s) => s.catalogPanels);
  const selectedPanelId = usePlannerV2Store((s) => s.selectedPanelId);
  const setSelectedPanel = usePlannerV2Store((s) => s.setSelectedPanel);

  // dati necessari per "In Module umwandeln"
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);
  const setModules = usePlannerV2Store((s) => s.setModules);
  const commitRoofLayout = usePlannerV2Store((s) => s.commitRoofLayout);
  const snapshot = usePlannerV2Store((s) => s.snapshot);
  const selSpec = usePlannerV2Store((s) => s.getSelectedPanel());
  const selectedPlanningDraft = usePlannerV2Store((s) =>
    s.selectedId ? s.roofPlanningDrafts[s.selectedId] : undefined,
  );
  const manualPlacementSession = useManualPlacementSession();
  const showFieldDimensions = usePlannerV2Store((s) => s.ui.showFieldDimensions);
  const setUI = usePlannerV2Store((s) => s.setUI);

  const selectedRoof = useMemo(
    () => layers.find((roof) => roof.id === selectedId),
    [layers, selectedId],
  );
  const persistedSurfacePlanning = useMemo(
    () => resolveSurfacePlanning(selectedRoof?.surfacePlanning),
    [selectedRoof?.surfacePlanning],
  );
  const displayedAdvancedConfig =
    selectedPlanningDraft?.targetMode === "advanced"
      ? selectedPlanningDraft.config
      : !selectedPlanningDraft &&
          persistedSurfacePlanning.status === "supported-advanced"
        ? persistedSurfacePlanning.config
        : undefined;
  const manualPlacementKind = displayedAdvancedConfig
    ? "advanced-block"
    : selectedPlanningDraft?.targetMode === "standard" ||
        persistedSurfacePlanning.effectiveMode === "standard"
      ? "standard-module"
      : undefined;
  const manualPlacementLabel =
    displayedAdvancedConfig?.advanced.system.systemId === K2_D_DOME_SYSTEM_ID
      ? "Einzelnen K2 Block platzieren"
      : "Einzelnes Modul platzieren";
  const manualPlacementActive = Boolean(
    manualPlacementSession &&
      manualPlacementSession.roofId === selectedId &&
      manualPlacementSession.kind === manualPlacementKind,
  );

  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    [],
  );
  const mod = isMac ? "⌘" : "Ctrl";

  // Cmd/Ctrl+S → Save (placeholder)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t as any).isContentEditable)
      )
        return;
      const s = e.key?.toLowerCase() === "s";
      const saveCombo = (isMac && e.metaKey && s) || (!isMac && e.ctrlKey && s);
      if (saveCombo) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac]);

  const handleSave = async () => {
    let toastId: string | undefined;

    try {
      if (!planningId) {
        toast.error("Fehlende planningId in der URL");
        return;
      }

      toastId = toast.loading("Speichern läuft…");

      await savePlannerToDb(planningId);

      toast.success("Gespeichert ✅", { id: toastId });
    } catch (e: any) {
      const msg = e?.message ?? "Save failed";

      if (String(msg).includes("401")) {
        if (toastId) toast.error("Bitte einloggen…", { id: toastId });
        router.push(
          `/login?next=${encodeURIComponent(`/planner-v2?planningId=${planningId}`)}`,
        );
        return;
      }

      if (toastId) toast.error("Fehler beim Speichern", { id: toastId });
      else toast.error("Fehler beim Speichern");

      console.error("[Planner] Save failed:", e);
    }
  };

  const handleUndo = () => {
    history.undo();
  };
  const handleRedo = () => {
    history.redo();
  };

  const [canUndo, setCanUndo] = useState(history.canUndo());
  const [canRedo, setCanRedo] = useState(history.canRedo());
  useEffect(() => {
    const unsub = history.subscribe(() => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    }) as () => boolean;
    return () => {
      void unsub();
    };
  }, []);

  // ── Schneefang: Popup & Segmente (nur TopToolbar, lokal)
  const [isSnowDialogOpen, setIsSnowDialogOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [snowSegments, setSnowSegments] = useState<SnowSegment[]>([
    // di base un segmento da 10 m, giusto per non partire vuoto
    { id: "sg_init", lengthM: 0 },
  ]);
  const SNOW_PRICE_PER_M = 10; // 10 CHF pro Meter

  const totalSnowM = useMemo(
    () => snowSegments.reduce((sum, s) => sum + (s.lengthM || 0), 0),
    [snowSegments],
  );
  const totalSnowChf = useMemo(
    () => totalSnowM * SNOW_PRICE_PER_M,
    [totalSnowM],
  );

  /* ───────────────── Bottoni icona+tooltip (portal) ───────────────── */
  function ActionBtn({
    active,
    onClick,
    Icon,
    label,
    disabled,
    tooltipLabel,
    tooltipKeys,
  }: {
    active?: boolean;
    onClick: () => void;
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    label?: string; // non usato (icon-only)
    disabled?: boolean;
    tooltipLabel?: string;
    tooltipKeys?: (string | React.ReactNode)[];
  }) {
    const ref = useRef<HTMLButtonElement>(null);
    const { visible, pos, show, hide } = useBottomTooltip(ref);

    // Base: solo icona, nessun cerchio visibile
    const base =
      "inline-flex h-8 w-8 items-center justify-center rounded-full " +
      "transition ring-0 border border-transparent " +
      "focus:outline-none focus:ring-2 focus:ring-primary/25";

    // Inattivo cliccabile: icona bianca; il cerchio appare SOLO su hover
    const clickable =
      "text-muted-foreground hover:bg-secondary/70 hover:border-border hover:text-foreground";

    // Attivo: “icona accesa dentro un cerchio”
    const activeCls =
      "bg-primary text-primary-foreground border-primary shadow shadow-primary/20 " +
      "hover:bg-primary hover:border-primary";

    // Disabled: grigio, niente hover
    const disabledCls =
      "text-muted-foreground/50 opacity-60 cursor-not-allowed";

    const cls = [
      base,
      disabled ? disabledCls : active ? activeCls : clickable,
    ].join(" ");

    return (
      <>
        <button
          ref={ref}
          type="button"
          onMouseEnter={tooltipLabel ? show : undefined}
          onMouseLeave={tooltipLabel ? hide : undefined}
          onFocus={tooltipLabel ? show : undefined}
          onBlur={tooltipLabel ? hide : undefined}
          onClick={onClick}
          aria-pressed={!!active}
          disabled={disabled}
          className={cls}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>

        {tooltipLabel && tooltipKeys && (
          <PortalTooltip
            visible={visible}
            pos={pos}
            label={tooltipLabel}
            keys={tooltipKeys}
          />
        )}
      </>
    );
  }

  /* ─────────── Bottoni icon-only (Undo/Redo) con stesso stile ─────────── */
  function IconOnlyBtn({
    onClick,
    Icon,
    ariaLabel,
    tooltipLabel,
    tooltipKeys,
    disabled,
  }: {
    onClick: () => void;
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    ariaLabel: string;
    tooltipLabel: string;
    tooltipKeys: (string | React.ReactNode)[];
    disabled?: boolean;
  }) {
    const ref = useRef<HTMLButtonElement>(null);
    const { visible, pos, show, hide } = useBottomTooltip(ref);

    const base =
      "inline-flex h-8 w-8 items-center justify-center rounded-full " +
      "transition ring-0 border border-transparent " +
      "focus:outline-none focus:ring-2 focus:ring-primary/25";

    const clickable =
      "text-muted-foreground hover:bg-secondary/70 hover:border-border hover:text-foreground";

    const disabledCls =
      "text-muted-foreground/50 opacity-60 cursor-not-allowed";

    const cls = [base, disabled ? disabledCls : clickable].join(" ");

    return (
      <>
        <button
          ref={ref}
          type="button"
          aria-label={ariaLabel}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={onClick}
          disabled={disabled}
          className={cls}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
        <PortalTooltip
          visible={visible}
          pos={pos}
          label={tooltipLabel}
          keys={tooltipKeys}
        />
      </>
    );
  }

  /* UI unificata: tutti i tool sempre visibili (attivi logici via step auto-switch) */
  /* Tool attivi solo nello step corrente */
  const canUseBuildingTools = step === "building";
  const canUseModulesTools = step === "modules";

  /* ── Nessun auto-switch: il tool cambia solo se lo step corrente lo consente ── */
  function go(t: any) {
    if (manualPlacementSession) endManualPlacement();
    setTool(t);
  }

  function ensureModulesPrereqsForU(): boolean {
    const st = usePlannerV2Store.getState();

    if (st.step !== "modules") {
      toast.error("Du musst dich im Schritt „Module“ befinden.");
      return false;
    }

    // se vuoi, puoi riattivare il controllo roof selezionato come toast:
    if (!st.selectedId) {
      toast.error("Wähle zuerst eine Dachfläche aus, bevor du U verwendest.");
      return false;
    }

    if (!st.getSelectedPanel()) {
      toast.error("Wähle ein Solarmodell aus dem Katalog aus.");
      return false;
    }

    if (!st.snapshot?.mppImage) {
      toast.error("Maßstab fehlt (mppImage im Snapshot).");
      return false;
    }

    return true;
  }

  function ensureModulesPrereqsForF(): boolean {
    const st = usePlannerV2Store.getState();

    if (st.step !== "modules") {
      toast.error("Du musst dich im Schritt „Module“ befinden.");
      return false;
    }

    // se un domani vuoi forzare la selezione di una falda:
    if (!st.selectedId) {
      toast.error(
        "Wähle zuerst eine Dachfläche aus, bevor du eine Fläche füllst.",
      );
      return false;
    }

    return true;
  }

  function handleManualPlacement() {
    if (manualPlacementActive) {
      endManualPlacement();
      return;
    }
    if (!canUseModulesTools) {
      toast.error("Du musst dich im Schritt „Module“ befinden.");
      return;
    }
    if (!selectedId || !selectedRoof) {
      toast.error("Wähle zuerst eine Dachfläche aus.");
      return;
    }
    if (!snapshot.mppImage) {
      toast.error("Maßstab fehlt (mppImage im Snapshot).");
      return;
    }
    if (!manualPlacementKind) {
      toast.error("Diese Dachkonfiguration unterstützt keine manuelle Platzierung.");
      return;
    }
    if (
      manualPlacementKind === "advanced-block" &&
      !displayedAdvancedConfig?.advanced.module.panelSpecId
    ) {
      toast.error("Wähle zuerst ein Solarmodul aus.");
      return;
    }
    if (manualPlacementKind === "standard-module") {
      const panelSpecId =
        selectedPlanningDraft?.targetMode === "standard"
          ? selectedPlanningDraft.panelSpecId
          : selectedPanelId;
      if (!catalogPanels.some((panel) => panel.id === panelSpecId)) {
        toast.error("Wähle zuerst ein Solarmodul aus.");
        return;
      }
    }

    setTool("select");
    beginManualPlacement({ roofId: selectedId, kind: manualPlacementKind });
  }

  /* ── Handler: In Module umwandeln (icona #3) ─────────────────────── */
  function handleConvertToModules() {
    endManualPlacement();
    // Porta l'interfaccia in "modules"
    if (step !== "modules") setStep("modules" as any);

    // prerequisiti base
    if (!selectedId || !snapshot?.mppImage) return;

    const roof = layers.find((l) => l.id === selectedId);
    if (!roof?.points?.length) return;
    const standardDraft = selectedPlanningDraft?.targetMode === "standard"
      ? selectedPlanningDraft
      : undefined;
    const standardModules = standardDraft?.modules ?? modules;
    const standardPanel = standardDraft
      ? catalogPanels.find((panel) => panel.id === standardDraft.panelSpecId)
      : selSpec;
    if (!standardPanel) return;

    const canvasAngleDeg = resolveStandardAutoLayoutCanvasAngle({
      roofId: selectedId,
      roofPolygon: roof.points,
      legacyRoofAzimuthDeg: roof.azimuthDeg,
      gridAngleDeg: standardModules.gridAngleDeg,
      perRoofAngles: standardModules.perRoofAngles,
      referenceEdgeIndex: roof.referenceEdgeIndex,
    });
    const currentState = usePlannerV2Store.getState();
    const obstacles = selectLegacyStandardObstacles(
      currentState.zones,
      currentState.snowGuards,
      selectedId,
    );
    const spacing = resolveStandardAutoLayoutSpacingAxes(standardModules);
    const layout = computeLegacyStandardLayout({
      generation: {
        roofPolygon: roof.points,
        mppImage: snapshot.mppImage,
        canvasAngleDeg,
        orientation: standardModules.orientation,
        panelSizeM: { widthM: standardPanel.widthM, heightM: standardPanel.heightM },
        spacingM: spacing.x,
        spacingXM: spacing.x,
        spacingYM: spacing.y,
        marginM: resolveRoofEdgeMarginM(roof, standardModules.marginM),
        phaseX: standardModules.gridPhaseX ?? 0,
        phaseY: standardModules.gridPhaseY ?? 0,
        anchorX: standardModules.gridAnchorX ?? "start",
        anchorY: standardModules.gridAnchorY ?? "start",
        coverageRatio: standardModules.coverageRatio ?? 1,
      },
      reservedZones: obstacles.reservedZones,
      snowGuards: obstacles.snowGuards,
      filterPolicy: STANDARD_AUTO_LAYOUT_POLICY.filterPolicy,
    });

    const commitAction = resolveStandardAutoLayoutCommitAction(layout.count);
    if (commitAction === "preserve") return;

    // === crea pannelli reali
    const now = Date.now().toString(36);
    const orderedPlacements = orderStandardAutoLayoutPlacements(
      layout.placements,
      {
        roofPolygon: roof.points,
        referenceEdgeIndex: roof.referenceEdgeIndex,
        fallAzimuthDeg: resolveRoofFallAzimuth(roof),
      },
    );
    const moduleTilt = standardDraft?.moduleTilt ?? resolveStandardTiltInput(roof.surfacePlanning);
    const standardMetadata = buildStandardPanelMetadata({ roofSlopeDeg: roof.tiltDeg, moduleTilt });
    const instances = orderedPlacements.map((r, idx) => ({
      id: `${selectedId}_p_${now}_${idx}`,
      roofId: selectedId,
      cx: r.cx,
      cy: r.cy,
      wPx: r.wPx,
      hPx: r.hPx,
      angleDeg: r.angleDeg,
      orientation: standardModules.orientation,
      panelId: standardPanel.id,
      ...(standardMetadata ? { standard: standardMetadata } : {}),
    }));

    commitRoofLayout({
      roofId: selectedId,
      panels: instances,
      surfacePlanning: buildStandardSurfacePlanning({ roof, moduleTilt }),
    });
    setSelectedPanel(standardPanel.id);
    setModules({ ...standardModules, showGrid: false });

    // torna allo strumento selezione
    setTool("select" as any);
  }

  return (
    <div className="flex h-10 items-center justify-between gap-2 overflow-x-auto overscroll-x-contain bg-transparent px-2 text-foreground scrollbar-thin scrollbar-track-transparent scrollbar-thumb-transparent">
      {/* SX: sequenza unica — Auswählen + icone 1–6 + controlli moduli */}
      <div className=" flex min-w-0 items-center gap-2">
        <TopbarAddressSearch />
        {/* Auswählen → SEMPRE attivo */}
        <ActionBtn
          active={tool === "select" && !manualPlacementSession}
          onClick={() => go("select" as any)}
          Icon={MousePointer}
          label=""
          tooltipLabel="Auswählen"
          tooltipKeys={["A"]}
        />

        {/* Gebäude-only */}
        <ActionBtn
          active={tool === "draw-roof"}
          onClick={() => go("draw-roof" as any)}
          Icon={TbShape3}
          label=""
          disabled={!canUseBuildingTools}
          tooltipLabel="Dach zeichnen"
          tooltipKeys={["D"]}
        />

        <ActionBtn
          active={tool === "draw-rect"}
          onClick={() => go("draw-rect" as any)}
          Icon={AiOutlineBorderHorizontal}
          label=""
          disabled={!canUseBuildingTools}
          tooltipLabel="Rechteck zeichnen"
          tooltipKeys={["R"]}
        />

        <ActionBtn
          active={tool === "draw-reserved"}
          onClick={() => go("draw-reserved" as any)}
          Icon={MdOutlineTexture}
          label=""
          disabled={!canUseBuildingTools}
          tooltipLabel="Hindernis · Freie Form"
          tooltipKeys={["H"]}
        />

        <ActionBtn
          active={tool === "draw-reserved-rect"}
          onClick={() => go("draw-reserved-rect")}
          Icon={Square}
          label=""
          disabled={!canUseBuildingTools}
          tooltipLabel="Hindernis · Rechteck"
          tooltipKeys={["Ziehen"]}
        />

        {/* Module-only */}
        <ActionBtn
          onClick={() => {
            if (ensureModulesPrereqsForU()) handleConvertToModules();
          }}
          Icon={MdViewModule}
          label=""
          disabled={!canUseModulesTools}
          tooltipLabel="Autolayout umwandeln"
          tooltipKeys={["U"]}
        />

        <ActionBtn
          active={tool === "fill-area"}
          onClick={() => {
            if (ensureModulesPrereqsForF()) go("fill-area" as any);
          }}
          Icon={MdBorderStyle}
          label=""
          disabled={!canUseModulesTools}
          tooltipLabel="Fläche füllen"
          tooltipKeys={["F"]}
        />

        <ActionBtn
          active={manualPlacementActive}
          onClick={handleManualPlacement}
          Icon={MdAddBox}
          label=""
          disabled={!canUseModulesTools || !selectedId}
          tooltipLabel={manualPlacementLabel}
          tooltipKeys={["Klick"]}
        />

        <div className="mx-1 h-6 w-px bg-border" />

        {/* 6) Schneefang (linea) — placeholder */}
        {/* Schneefang / Protezione neve */}
        {/* <ActionBtn
          active={tool === "draw-snow-guard"}
          onClick={() => {
            if (canUseBuildingTools) {
              setTool("draw-snow-guard" as any);
            }
          }}
          Icon={LuSnowflake}
          label=""
          disabled={!canUseBuildingTools}
          tooltipLabel="Schneefang / Protezione neve"
          tooltipKeys={["S"]}
        /> */}

        {/* Schneefang – Kalkulation */}
        <div className="flex items-center gap-1">
          <ActionBtn
            onClick={() => setIsSnowDialogOpen(true)}
            Icon={LuSnowflake}
            label=""
            tooltipLabel="Schneefang – Kalkulation"
            tooltipKeys={["Preis"]}
          />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {totalSnowM.toFixed(1)} m · {totalSnowChf.toFixed(2)} CHF
          </span>
        </div>

        {/* Controls specifici moduli (sempre visibili; clic portarli in 'modules') */}
        {/* <div className="mx-1 h-6 w-px bg-neutral-200" />

        <div
          aria-disabled={!canUseModulesTools}
          className={!canUseModulesTools ? 'opacity-50 pointer-events-none' : ''}
          onPointerDown={() => { if (step !== 'modules') setStep('modules' as any); }}
        >
          <OrientationToggle />
        </div>

        <div className="mx-1 h-6 w-px bg-neutral-200" /> */}

        {/* <label htmlFor="topbar-panel-select" className="sr-only">Modul wählen</label>
        <select
          id="topbar-panel-select"
          aria-label="Modul wählen"
          value={selectedPanelId}
          onChange={(e) => { if (step !== 'modules') setStep('modules' as any); setSelectedPanel(e.target.value); }}
          disabled={!canUseModulesTools}
          className={[
            "h-8 min-w-[220px] max-w-[320px] rounded-full border border-neutral-200 bg-white/80 px-2 text-xs text-neutral-900 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-black/10",
            !canUseModulesTools ? "opacity-50 cursor-not-allowed" : ""
          ].join(' ')}
        >
          {catalogPanels.map(p => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.model} — {p.wp} W
            </option>
          ))}
        </select> */}
      </div>

      {/* DESTRA: 7–10 compatti + Undo/Redo */}
      <div className="flex items-center ms-auto gap-1">
        {canUseModulesTools && (
          <button
            type="button"
            onClick={() => setUI({ showFieldDimensions: !showFieldDimensions })}
            className={[
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
              showFieldDimensions
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            ].join(" ")}
            aria-pressed={showFieldDimensions}
            title="Montagefeld-Maße anzeigen"
          >
            <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
            Feldmaße
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/80 bg-amber-400 text-neutral-950 shadow-sm transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300/50"
          aria-label={`${step === "building" ? "Gebäudeplanung" : "Modulplanung"} Hilfe öffnen`}
          title="Hilfe"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* 7) Neue Variante — placeholder */}

        {/* 8) Trasparenza — placeholder */}

        {/* 9) Leeren — placeholder */}

        {/* 10) Speichern — placeholder */}
        <ActionBtn
          onClick={handleSave}
          Icon={IoIosSave}
          label=""
          disabled={false}
          tooltipLabel="Speichern"
          tooltipKeys={[mod, "S"]}
        />
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      {/* DX: Undo/Redo (icon-only) */}
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <IconOnlyBtn
          onClick={handleUndo}
          Icon={RotateCcw}
          ariaLabel="Rückgängig"
          tooltipLabel="Rückgängig"
          tooltipKeys={isMac ? ["⌘", "Z"] : ["Ctrl", "Z"]}
          disabled={!canUndo}
        />
        <IconOnlyBtn
          onClick={handleRedo}
          Icon={RotateCw}
          ariaLabel="Wiederholen"
          tooltipLabel="Wiederholen"
          tooltipKeys={isMac ? ["⇧", "⌘", "Z"] : ["Ctrl", "Y"]}
          disabled={!canRedo}
        />
        <div className="mx-1 h-6 w-px bg-border" />

        <ProjectStatsBar />

        <SnowGuardCostDialog
          open={isSnowDialogOpen}
          onClose={() => setIsSnowDialogOpen(false)}
          segments={snowSegments}
          setSegments={setSnowSegments}
          pricePerM={SNOW_PRICE_PER_M}
        />

        <PlannerHelpDialog
          open={isHelpOpen}
          step={step}
          onClose={() => setIsHelpOpen(false)}
          onChooseTool={(nextTool) => setTool(nextTool)}
        />
      </div>
    </div>
  );
}
