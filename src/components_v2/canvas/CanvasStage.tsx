"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Rect,
  Group,
  Text,
} from "react-konva";
import { isInReservedZone } from "../zones/utils";
import { RotateCcw } from "lucide-react";

import { Pt, polygonAreaPx2, rectFrom3WithAz } from "../canvas/geom";
import { usePlannerV2Store } from "../state/plannerV2Store";

import ScaleIndicator from "./ScaleIndicator";
import SonnendachOverlayKonva from "./SonnendachOverlayKonva";
import OrientationHUD from "./OrientationHUD";
import ModulesPreview from "../modules/ModulesPreview";
import AdvancedPreviewLayer from "../modules/advanced/AdvancedPreviewLayer";
import RoofDimensionLabelsLayer from "./RoofDimensionLabelsLayer";
import RoofReferenceEdgeLayer from "./RoofReferenceEdgeLayer";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutSpacingAxes,
} from "../modules/legacyStandardApplicationPolicy";
import OverlayTopToolbar from "../layout/OverlayTopToolbar";
import OverlayProgressStepper from "../layout/OverlayProgressStepper";
import CenterAddressSearchOverlay from "../layout/CenterAddressSearchOverlay";
import OverlayRightToggle from "../layout/OverlayRightToggle";
import { AnimatePresence, motion } from "framer-motion";
import RightPropertiesPanelOverlay from "../layout/RightPropertiesPanelOverlay";
import OverlayLeftToggle from "../layout/OverlayLeftToggle";
import LeftLayersOverlay from "../layout/LeftLayersOverlay";
import PanelsLayer from "../modules/panels/PanelsLayer";
import RoofShapesLayer from "./RoofShapesLayer";
import RoofAzimuthArrows from "./RoofAzimuthArrows";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import RoofHudOverlay from "./RoofHudOverlay";
import { useContainerSize } from "../canvas/hooks/useContainerSize";
import { useBaseImage } from "../canvas/hooks/useBaseImage";
import { useStagePanZoom } from "../canvas/hooks/useStagePanZoom";
import { useDrawingTools } from "../canvas/hooks/useDrawingTools";
import DrawingOverlays from "./DrawingOverlays";
import TransientDrawingPreviews from "./TransientDrawingPreviews";
import PanelHotkeys from "../modules/panels/PanelHotkeys";
import { nanoid } from "nanoid";
import ZonesLayer from "../zones/ZonesLayer";
import FillAreaController from "../modules/fill/FillAreaController";
import ToolHotkeys from "../layout/ToolHotkeys";
import { history as plannerHistory } from "../state/history";
import ProjectStatsBar from "../ui/ProjectStatsBar";
import CanvasHotkeys from "./CanvasHotekeys";
import ModuleSprite from "../modules/ModuleSprite";
import ScreenGrid from "./ScreenGrid";
import CompassHUD from "../compassHUD";
import RoofHotkeys from "../RoofHotkeys";
import ProfileStep from "../steps/ProfileStep";
import IstSituationStep from "../steps/IstSituationStep";
import StucklisteScreen from "../steps/StucklisteScreen";
import ReportScreen from "../steps/ReportScreen";
import OfferScreen from "../steps/OfferScreen";
import { plannerTheme } from "../theme/plannerTheme";
import PlannerEmptyState from "../layout/PlannerEmptyState";
import type { Tool } from "@/types/planner";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import {
  findRoofAtPoint,
  isDrawingInteractionTool,
  isPrimaryPointerButton,
  resolveEscapeAction,
  resolveInteractionCursor,
  resolvePlannerInteractionMode,
  shouldIgnorePlannerHotkeyTarget,
} from "./interactionPolicy";

const deg2rad = (d: number) => (d * Math.PI) / 180;
function centroid(pts: Pt[]) {
  let x = 0,
    y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}
function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}
function rot(p: Pt, theta: number): Pt {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
  return rot(sub(p, O), -theta);
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
  return add(rot(p, theta), O);
}

declare global {
  interface Window {
    __helionicCaptureProjectSnapshot?: () => Promise<string | null>;
  }
}

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  useEffect(() => {
    window.__helionicCaptureProjectSnapshot = async () => {
      try {
        const stage = stageRef.current?.getStage?.();

        if (!stage) {
          console.warn("[Planner] No Konva stage available for snapshot");
          return null;
        }

        const dataUrl = stage.toDataURL({
          pixelRatio: 1,
          mimeType: "image/jpeg",
          quality: 0.72,
        });

        console.log("[Planner] Project snapshot captured", {
          length: dataUrl.length,
        });

        return dataUrl;
      } catch (err) {
        console.warn("[Planner] Snapshot capture failed:", err);
        return null;
      }
    };

    return () => {
      delete window.__helionicCaptureProjectSnapshot;
    };
  }, []);

  const step = usePlannerV2Store((s) => s.step);
  // store
  const isFormStep = step === "profile" || step === "ist";
  const isPartsStep = step === "parts";
  const isReportStep = step === "report";
  const isOfferStep = step === "offer";

  const snap = usePlannerV2Store((s) => s.snapshot);
  const view = usePlannerV2Store((s) => s.view);
  const setView = usePlannerV2Store((s) => s.setView);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const addRoof = usePlannerV2Store((s) => s.addRoof);
  const select = usePlannerV2Store((s) => s.select);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const rightOpen = usePlannerV2Store((s) => s.ui.rightPanelOpen);
  const modules = usePlannerV2Store((s) => s.modules);
  const allPanels = usePlannerV2Store((s) => s.panels);
  const roofPlanningDrafts = usePlannerV2Store((s) => s.roofPlanningDrafts);
  const catalogPanels = usePlannerV2Store((s) => s.catalogPanels);
  const duplicatePanel = usePlannerV2Store((s) => s.duplicatePanel);
  const addZone = usePlannerV2Store((s) => s.addZone);
  const addSnowGuard = usePlannerV2Store((s) => s.addSnowGuard);
  const snowGuards = usePlannerV2Store((s) => s.snowGuards);
  const selectedSnowGuardId = usePlannerV2Store((s) => s.selectedSnowGuardId);
  const setSelectedSnowGuard = usePlannerV2Store((s) => s.setSelectedSnowGuard);
  const deleteSnowGuard = usePlannerV2Store((s) => s.deleteSnowGuard);

  const selPanel = usePlannerV2Store((s) => s.getSelectedPanel());
  const roofAlign = usePlannerV2Store((s) => s.roofAlign);
  const setTool = usePlannerV2Store((s) => s.setTool);

  // in cima a CanvasStage

  const selectZone = usePlannerV2Store((s) => s.selectZone); // ⬅️ nuovo

  // Boundary esplicito tra lo store e l'hook di disegno.
  const setToolForHook = useCallback(
    (t: Tool) => {
      setTool(t);
    },
    [setTool],
  );

  // size + base image
  const size = useContainerSize(containerRef);
  const handleCoverComputed = useCallback(
    (cover: number, ox: number, oy: number) => {
      setView({ fitScale: cover, scale: cover, offsetX: ox, offsetY: oy });
    },
    [setView],
  );
  const { img } = useBaseImage({
    url: snap.url ?? "",
    size,
    onCoverComputed: handleCoverComputed,
  });

  // UI states
  const [shapeMode, setShapeMode] = useState<"normal" | "trapezio">("normal");
  const [draggingVertex, setDraggingVertex] = useState(false);
  const [draggingPanel, setDraggingPanel] = useState(false);
  const [selectedPanelInstId, setSelectedPanelInstId] = useState<
    string | undefined
  >(undefined);
  const deletePanel = usePlannerV2Store((s) => s.deletePanel);
  const SHOW_AREA_LABELS = false;

  const [showUiGrid, setShowUiGrid] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key === "g" || e.key === "G") &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        setShowUiGrid((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener(
        "keydown",
        onKey as any,
        { capture: true } as any,
      );
  }, []);

  // --- ROTAZIONE MANUALE ---
  // const [rotateDeg, setRotateDeg] = useState(0);
  const contentGroupRef = useRef<any>(null);

  // Hotkeys: [ e ] per ±1°, Shift+[ / Shift+] per ±10°
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // ignora se stai scrivendo
      const isTyping = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return true;
        if ((el as any).isContentEditable) return true;
        if (
          el.closest?.(
            'input,textarea,[contenteditable="true"],[data-stop-hotkeys="true"]',
          )
        )
          return true;
        return false;
      };
      if (
        isTyping(ev.target as HTMLElement | null) ||
        isTyping(document.activeElement as HTMLElement | null)
      )
        return;

      if (ev.key === "[" || ev.key === "]") {
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        setRotateDeg((d) => d + (ev.key === "]" ? step : -step));
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, []);

  // draft del riempi-area
  const [fillDraft, setFillDraft] = useState<{
    a: Pt;
    b: Pt;
    poly: Pt[];
    rects: {
      cx: number;
      cy: number;
      wPx: number;
      hPx: number;
      angleDeg: number;
    }[];
  } | null>(null);
  const [fillCancelVersion, setFillCancelVersion] = useState(0);

  const selectedRoof = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId],
  );
  const selectedRoofPlanning = selectedRoof
    ? resolveSurfacePlanning(selectedRoof.surfacePlanning)
    : undefined;
  const selectedRoofSlopeDeg = selectedRoofPlanning?.status === "supported-advanced"
    ? selectedRoofPlanning.config.surface.slopeDeg ?? selectedRoof?.tiltDeg ?? 0
    : selectedRoof?.tiltDeg ?? 0;
  const selectedRoofFallAzimuth = selectedRoofPlanning?.status === "supported-advanced"
    ? selectedRoofPlanning.config.surface.fallAzimuthDeg ?? (selectedRoof ? resolveRoofFallAzimuth(selectedRoof) : undefined)
    : selectedRoof
      ? resolveRoofFallAzimuth(selectedRoof)
      : undefined;
  const showPanelsInBuilding = usePlannerV2Store(
    (state) => state.ui.showPanelsInBuilding,
  );
  const selectedPlanningDraft = selectedId ? roofPlanningDrafts[selectedId] : undefined;
  const standardPreviewModules = selectedPlanningDraft?.targetMode === "standard"
    ? selectedPlanningDraft.modules
    : modules;
  const standardPreviewPanel = selectedPlanningDraft?.targetMode === "standard"
    ? catalogPanels.find((panel) => panel.id === selectedPlanningDraft.panelSpecId)
    : selPanel;

  const baseGridDeg = selectedRoof
    ? resolveStandardAutoLayoutCanvasAngle({
      roofId: selectedRoof.id,
      roofPolygon: selectedRoof.points,
      legacyRoofAzimuthDeg: selectedRoof.azimuthDeg,
      referenceEdgeIndex: selectedRoof.referenceEdgeIndex,
    })
    : 0;

  // angolo finale della preview, condiviso con tutti i percorsi di commit
  const gridDeg = selectedRoof
    ? resolveStandardAutoLayoutCanvasAngle({
      roofId: selectedRoof.id,
      roofPolygon: selectedRoof.points,
      legacyRoofAzimuthDeg: selectedRoof.azimuthDeg,
      gridAngleDeg: standardPreviewModules.gridAngleDeg,
      perRoofAngles: standardPreviewModules.perRoofAngles,
      referenceEdgeIndex: selectedRoof.referenceEdgeIndex,
    })
    : 0;

  const hasPanelsOnSelected = useMemo(
    () =>
      !!selectedId &&
      allPanels.some((p) => p.roofId === selectedId),
    [allPanels, selectedId],
  );

  // reset shapeMode on selection change
  useEffect(() => {
    setShapeMode("normal");
  }, [selectedId]);

  // subito sotto gli altri useEffect
  useEffect(() => {
    if (tool === "draw-reserved") {
      setSelectedPanelInstId(undefined);
    }
  }, [tool]);

  // CanvasStage.tsx – vicino ad altri useEffect in alto
  // CanvasStage.tsx – SOSTITUISCI il vecchio useEffect con questo
  useEffect(() => {
    type KbEvt = KeyboardEvent & { stopImmediatePropagation?: () => void };

    const onKey = (ev: KbEvt) => {
      // ⛔️ NON reagire se il focus è su un campo di input / editor
      const isTyping = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return true;
        if ((el as any).isContentEditable) return true;
        if (
          el.closest?.(
            'input,textarea,[contenteditable="true"],[data-stop-hotkeys="true"]',
          )
        )
          return true;
        return false;
      };
      if (
        isTyping(ev.target as HTMLElement | null) ||
        isTyping(document.activeElement as HTMLElement | null)
      ) {
        return;
      }

      const st = usePlannerV2Store.getState();
      const key = ev.key;

      // ---------- DELETE con PRIORITÀ ----------
      if (key === "Delete" || key === "Backspace") {
        // 0) snow guard selezionata → elimina
        if (st.selectedSnowGuardId) {
          const id = st.selectedSnowGuardId;
          plannerHistory.push("delete snow guard");
          st.deleteSnowGuard?.(id);
          st.setSelectedSnowGuard?.(undefined);
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
          return;
        }

        // 1) ZONA selezionata → elimina SOLO la zona (con guardie)
        if (st.selectedZoneId) {
          const zoneId = st.selectedZoneId;
          const z = (st as any).zones?.find?.((zz: any) => zz.id === zoneId);
          const roofId = z?.roofId as string | undefined;

          // disinnesca altri handler
          st.setSelectedPanels?.([]);
          st.clearPanelSelection?.();
          st.select?.(undefined); // rimuovi temporaneamente la selezione falda

          plannerHistory.push("delete zone");
          st.removeZone?.(zoneId);
          st.selectZone?.(undefined);

          // blocca completamente la propagazione
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();

          // ripristina selezione falda nel tick successivo
          if (roofId) {
            setTimeout(() => {
              const S = usePlannerV2Store.getState();
              S.select?.(roofId);
            }, 0);
          }
          return;
        }

        // 2) PANNELLI selezionati → elimina SOLO i pannelli
        if (
          Array.isArray(st.selectedPanelIds) &&
          st.selectedPanelIds.length > 0
        ) {
          plannerHistory.push("delete panels");
          if (st.deletePanelsBulk) st.deletePanelsBulk(st.selectedPanelIds);
          else
            st.selectedPanelIds.forEach((id: string) => st.deletePanel?.(id));
          st.setSelectedPanels?.([]);
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
          return;
        }

        // 3) FALDA selezionata → elimina la falda
        if (st.selectedId) {
          // ⛔️ Blocco: in modalità "modules" non si possono eliminare falde
          if (st.step === "modules") {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();
            return;
          }

          plannerHistory.push("delete roof");
          const del =
            (st as any).deleteRoof ?? // legacy
            st.removeRoof ?? // current
            st.deleteLayer; // fallback

          del?.(st.selectedId);
          st.select?.(undefined);
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
          return;
        }
      }

    };

    // capture:true → la guardia corre PRIMA degli altri listener
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, []);

  // CanvasStage.tsx – subito dopo la definizione di stageRef
  useEffect(() => {
    const stage = stageRef.current?.getStage?.();
    const container: HTMLDivElement | undefined = stage?.container?.();
    if (!container) return;

    // rende il container focusabile e focus al primo click
    container.tabIndex = 0;
    const focusOnPointer = () => container.focus();
    container.addEventListener("mousedown", focusOnPointer, { passive: true });
    container.addEventListener("touchstart", focusOnPointer, { passive: true });

    return () => {
      container.removeEventListener("mousedown", focusOnPointer);
      container.removeEventListener("touchstart", focusOnPointer);
    };
  }, []);

  // --- ROTAZIONE: utils + handlers ---
  const wrapDeg = (d: number) => {
    // normalizza in [-180, 180]
    const n = ((((d + 180) % 360) + 360) % 360) - 180;
    return Math.round(n);
  };

  const [rotateDeg, setRotateDeg] = useState(0); // se non l'hai già
  const [rotInput, setRotInput] = useState<string>("0");

  // calcolo progress per lo slider (0–100)
  const sliderPct = useMemo(() => {
    return Math.min(100, Math.max(0, ((rotateDeg + 180) / 360) * 100));
  }, [rotateDeg]);

  // mantieni l'input sincronizzato quando ruoti da bottoni/hotkeys/altro
  useEffect(() => {
    setRotInput(String(rotateDeg));
  }, [rotateDeg]);

  const bumpRotation = (delta: number) => {
    setRotateDeg((d) => wrapDeg(d + delta));
  };

  const applyRotationFromInput = () => {
    const v = parseFloat(rotInput.replace(",", "."));
    if (Number.isFinite(v)) setRotateDeg(wrapDeg(v));
    else setRotInput(String(rotateDeg)); // ripristina se input invalido
  };

  // pan/zoom
  const {
    canDrag,
    isRightPanning,
    onWheel,
    onDragMove,
    onDragEnd: onStageDragEnd,
    beginRightPan,
    moveRightPan,
    endRightPan,
  } = useStagePanZoom({
    img,
    size,
    view,
    setView,
  });

  // stage -> image coords
  // stage -> image coords (considera rotazione e scala/pan del gruppo)
  const toImgCoords = useCallback(
    (stageX: number, stageY: number): Pt => {
      const g = contentGroupRef.current;
      if (g?.getAbsoluteTransform) {
        const inv = g.getAbsoluteTransform().copy().invert();
        const p = inv.point({ x: stageX, y: stageY });
        return { x: p.x, y: p.y };
      }
      // fallback (non dovrebbe servire)
      const s = view.scale || view.fitScale || 1;
      return {
        x: (stageX - (view.offsetX || 0)) / s,
        y: (stageY - (view.offsetY || 0)) / s,
      };
    },
    [view.scale, view.fitScale, view.offsetX, view.offsetY],
  );

  // abilita i tool di disegno solo in building
  const drawingEnabled =
    step === "building" &&
    (tool === "draw-roof" ||
      tool === "draw-rect" ||
      tool === "draw-reserved" ||
      tool === "draw-snow-guard");

  // hook disegno tetto/zone (solo building)
  const {
    drawingPoly,
    rectDraft,
    pointerChannel,
    onStageMouseMove,
    onStageClick,
    onStageDblClick,
    snowDraft,
    hasDraft: hasDrawingDraft,
    cancelDraft: cancelDrawingDraft,
  } = useDrawingTools({
    tool: drawingEnabled ? tool : "select",
    layers,
    addRoof,
    select,
    toImgCoords,
    onZoneCommit: (poly4: Pt[], targetRoofId: string) => {
      plannerHistory.push("add reserved zone");
      addZone({
        id: nanoid(),
        roofId: targetRoofId,
        type: "riservata",
        points: poly4,
      });
      selectZone(undefined);
    },
    onSnowGuardCommit: (p1: Pt, p2: Pt, targetRoofId: string) => {
      const mpp = snap.mppImage;
      if (!mpp) return;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenPx = Math.hypot(dx, dy);
      const lenM = lenPx * mpp;

      addSnowGuard({
        id: nanoid(),
        roofId: targetRoofId,
        p1,
        p2,
        lengthM: Number(lenM.toFixed(2)),
        pricePerM: 10,
      });
    },
    snap:
      tool === "draw-reserved"
        ? { tolDeg: 3, closeRadius: 4 }
        : { tolDeg: 5, closeRadius: 5 },
    setTool: setToolForHook,
  });

  // Il pan col tasto destro vive sul container Konva, quindi non può essere
  // intercettato da roof/panel/zone sottostanti. Il context menu è bloccato
  // soltanto dentro questo canvas.
  useEffect(() => {
    const stage = stageRef.current?.getStage?.();
    const container = stage?.container?.() as HTMLDivElement | undefined;
    if (!container) return;

    const onMouseDown = (event: MouseEvent) => {
      if (!beginRightPan(event, stage)) return;
      container.focus();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!moveRightPan(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!endRightPan()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    container.addEventListener("mousedown", onMouseDown, { capture: true });
    container.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove, { capture: true });
    window.addEventListener("mouseup", onMouseUp, { capture: true });
    window.addEventListener("blur", endRightPan);

    return () => {
      container.removeEventListener("mousedown", onMouseDown, { capture: true });
      container.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove, { capture: true });
      window.removeEventListener("mouseup", onMouseUp, { capture: true });
      window.removeEventListener("blur", endRightPan);
      endRightPan();
    };
  }, [img, size.w, size.h, beginRightPan, moveRightPan, endRightPan]);

  const hasFillDraft = Boolean(fillDraft);

  // Un solo owner per ESC: draft, pannelli, zona, Schneefang, falda.
  useEffect(() => {
    type EscapeKeyboardEvent = KeyboardEvent & {
      stopImmediatePropagation?: () => void;
    };

    const onEscape = (event: EscapeKeyboardEvent) => {
      if (event.key !== "Escape") return;

      const store = usePlannerV2Store.getState();
      const action = resolveEscapeAction({
        ignoredTarget:
          shouldIgnorePlannerHotkeyTarget(event.target) ||
          shouldIgnorePlannerHotkeyTarget(document.activeElement),
        hasDraft: hasDrawingDraft || hasFillDraft,
        selectedPanelCount: store.selectedPanelIds?.length ?? 0,
        hasSelectedZone: Boolean(store.selectedZoneId),
        hasSelectedSnowGuard: Boolean(store.selectedSnowGuardId),
        hasSelectedRoof: Boolean(store.selectedId),
      });

      switch (action) {
        case "cancel-draft":
          cancelDrawingDraft();
          if (hasFillDraft) {
            setFillCancelVersion((version) => version + 1);
            setFillDraft(null);
          }
          break;
        case "clear-panels":
          store.clearPanelSelection?.();
          break;
        case "clear-zone":
          store.setSelectedZone?.(undefined);
          break;
        case "clear-snow-guard":
          store.setSelectedSnowGuard?.(undefined);
          break;
        case "clear-roof":
          store.select?.(undefined);
          break;
        case "none":
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    window.addEventListener("keydown", onEscape, { capture: true });
    return () =>
      window.removeEventListener("keydown", onEscape, { capture: true });
  }, [hasDrawingDraft, hasFillDraft, cancelDrawingDraft]);

  // stile tetti
  const stroke = plannerTheme.roofStroke;
  const strokeSelected = plannerTheme.roofStrokeSelected;
  const fill = plannerTheme.roofFill;
  const strokeWidthNormal = 1;
  const strokeWidthSelected = 1.85;

  const areaLabel = (pts: Pt[]) => {
    if (!snap.mppImage) return null;
    const areaPx2 = polygonAreaPx2(pts);
    const m2 = areaPx2 * (snap.mppImage * snap.mppImage);
    return `${Math.round(m2)} m²`;
  };

  const drawingCapturesPointer = isDrawingInteractionTool(tool);
  const interactionMode = resolvePlannerInteractionMode({
    tool,
    isRightPanning,
    isEditing: draggingVertex || draggingPanel,
  });
  const cursor = resolveInteractionCursor({
    mode: interactionMode,
    canPan: canDrag && !draggingVertex && !draggingPanel,
  });

  useEffect(() => {
    const el = stageRef.current?.getStage?.()?.container?.();
    if (!el) return;
    el.style.cursor = cursor;
  }, [cursor, img, size.w, size.h]);

  const layerScale = view.scale || view.fitScale || 1;

  if (isFormStep) {
    return (
      <div
        ref={containerRef}
        className="relative h-full  w-full overflow-hidden "
      >
        <OverlayProgressStepper />
        <OverlayTopToolbar />

        <div
          className="absolute inset-0 flex items-start"
          style={{
            paddingTop: "calc(var(--tb, 48px) + 0px)",
          }}
        >
          <div className="w-full  h-full">
            {step === "profile" ? <ProfileStep /> : <IstSituationStep />}
          </div>
        </div>
      </div>
    );
  }

  if (isPartsStep) {
    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
      >
        <OverlayProgressStepper />
        <OverlayTopToolbar />

        <StucklisteScreen />
      </div>
    );
  }

  if (isReportStep) {
    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
      >
        <OverlayProgressStepper />
        <OverlayTopToolbar />
        <div
          className="absolute inset-0"
          style={{ paddingTop: "calc(var(--tb, 0px) + 0px)" }}
        >
          <ReportScreen />
        </div>
      </div>
    );
  }

  if (isOfferStep) {
    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
      >
        <OverlayProgressStepper />
        <OverlayTopToolbar />
        <div
          className="absolute inset-0"
          style={{ paddingTop: "calc(var(--tb, 48px) + 0px)" }}
        >
          <OfferScreen />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-background"
    >
      {!img && <PlannerEmptyState />}

      <OverlayProgressStepper />
      <OverlayTopToolbar />

      <ScaleIndicator />

      {/* {!snap.url && <CenterAddressSearchOverlay />} */}

      {/* <OverlayRightToggle /> */}

      <div
        className="fixed z-[310] pointer-events-auto"
        style={{
          left: "calc(var(--sb, 0px) -2px)", // planner senza sidebar CRM
          top: "calc(var(--tb, 48px) + 40px)", // sotto la topbar
          bottom: "0px",
          width: "var(--propW, 280px)",
        }}
      >
        <RightPropertiesPanelOverlay />
      </div>

      {img && size.w > 0 && size.h > 0 && (
        <div className="relative" style={{ width: size.w, height: size.h }}>
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            x={view.offsetX || 0}
            y={view.offsetY || 0}
            draggable={
              canDrag &&
              !drawingCapturesPointer &&
              !isRightPanning &&
              !draggingVertex &&
              !draggingPanel
            }
            onDragMove={onDragMove}
            onDragEnd={onStageDragEnd}
            onWheel={onWheel}
            // handler di disegno SOLO in building
            onMouseMove={(evt: any) => {
              if (tool === "fill-area") {
                const el = stageRef.current?.getStage?.()?.container?.();
                if (el) el.style.cursor = "crosshair";
                return; // non inoltrare agli handler di building
              }
              if (drawingEnabled) onStageMouseMove?.(evt);
            }}
            onMouseEnter={
              tool === "fill-area"
                ? () => {
                    const el = stageRef.current?.getStage?.()?.container?.();
                    if (el) el.style.cursor = "crosshair";
                  }
                : undefined
            }
            onClick={(evt: any) => {
              if (!isPrimaryPointerButton(evt?.evt?.button)) return;
              const st = stageRef.current?.getStage?.();
              const pos = st?.getPointerPosition?.();

              // 🔒 Regola speciale per FLÄCHE FÜLLEN
              if (tool === "fill-area") {
                if (!pos) return;
                const imgPt = toImgCoords(pos.x, pos.y);

                const inside = Boolean(findRoofAtPoint(imgPt, layers));
                if (!inside) {
                  // click fuori da ogni falda:
                  // - dimentichiamo qualsiasi anteprima
                  // - torniamo subito ad "Auswählen"
                  setFillDraft(null);
                  setTool("select");
                }
                // in ogni caso, non facciamo nient'altro qui
                return;
              }

              // —— building tools (draw roof/rect/reserved) ----
              if (drawingEnabled) {
                onStageClick?.(evt);
                return;
              }

              // —— comportamento normale di selezione (come prima) ----
              const target = evt.target;
              const targetName =
                typeof target?.name === "function" ? target.name() : "";

              const store = usePlannerV2Store.getState();

              const clickedInteractive = targetName?.includes("interactive");
              if (!clickedInteractive) {
                store.selectZone?.(undefined);
                store.clearPanelSelection?.();
              }

              if (target === st || targetName === "bg-catcher") {
                store.select?.(undefined);
              }
            }}
            onDblClick={
              drawingEnabled
                ? (evt: any) => {
                    if (isPrimaryPointerButton(evt?.evt?.button)) {
                      onStageDblClick?.();
                    }
                  }
                : undefined
            }
          >
            <Layer scaleX={layerScale} scaleY={layerScale}>
              <Group
                ref={contentGroupRef}
                x={img?.naturalWidth ? img.naturalWidth / 2 : 0}
                y={img?.naturalHeight ? img.naturalHeight / 2 : 0}
                offsetX={img?.naturalWidth ? img.naturalWidth / 2 : 0}
                offsetY={img?.naturalHeight ? img.naturalHeight / 2 : 0}
                rotation={rotateDeg}
              >
                {/* base image */}
                <KonvaImage
                  image={img}
                  width={img.naturalWidth}
                  height={img.naturalHeight}
                  listening={false}
                />

                <Rect
                  x={0}
                  y={0}
                  width={img.naturalWidth}
                  height={img.naturalHeight}
                  fill="rgba(0,0,0,0.001)"
                  listening={tool !== "fill-area"}
                  name="bg-catcher"
                  onClick={(event) => {
                    if (!isPrimaryPointerButton(event?.evt?.button)) return;
                    if (drawingCapturesPointer) return;
                    const st = usePlannerV2Store.getState();
                    st.setSelectedZone?.(undefined);
                    st.clearPanelSelection?.();
                    st.select?.(undefined);
                  }}
                />

                {/* --- TUTTO IL RESTO (ModulesPreview, SonnendachOverlayKonva, RoofShapesLayer, ZonesLayer, pannelli, anteprime, ecc.) RIMANE QUI DENTRO --- */}
                {step === "modules" &&
                  selectedRoof &&
                  standardPreviewPanel &&
                  snap.mppImage &&
                  standardPreviewModules.showGrid &&
                  selectedPlanningDraft?.targetMode !== "advanced" &&
                  (!hasPanelsOnSelected || selectedPlanningDraft?.targetMode === "standard") && (
                    <ModulesPreview
                      roofId={selectedRoof.id}
                      polygon={selectedRoof.points}
                      mppImage={snap.mppImage}
                      azimuthDeg={gridDeg}
                      orientation={standardPreviewModules.orientation}
                      panelSizeM={{ w: standardPreviewPanel.widthM, h: standardPreviewPanel.heightM }}
                      spacingM={resolveStandardAutoLayoutSpacingAxes(standardPreviewModules).x}
                      spacingXM={resolveStandardAutoLayoutSpacingAxes(standardPreviewModules).x}
                      spacingYM={resolveStandardAutoLayoutSpacingAxes(standardPreviewModules).y}
                      marginM={resolveRoofEdgeMarginM(selectedRoof, standardPreviewModules.marginM)}
                      textureUrl="/images/panel.webp"
                      phaseX={standardPreviewModules.gridPhaseX || 0}
                      phaseY={standardPreviewModules.gridPhaseY || 0}
                      anchorX={(standardPreviewModules.gridAnchorX as any) || "start"}
                      anchorY={(standardPreviewModules.gridAnchorY as any) || "start"}
                      coverageRatio={standardPreviewModules.coverageRatio ?? 1}
                    />
                  )}

                {step === "modules" && <AdvancedPreviewLayer />}
                <RoofDimensionLabelsLayer />
                <RoofReferenceEdgeLayer />

                <Group listening={!drawingCapturesPointer}>
                  <SonnendachOverlayKonva />
                </Group>

                {/* I drawing tool catturano il click: niente selezione/drag sottostante. */}
                <Group listening={!drawingCapturesPointer}>
                  <RoofShapesLayer
                    layers={layers}
                    selectedId={selectedId}
                    onSelect={select}
                    showAreaLabels={SHOW_AREA_LABELS}
                    stroke={stroke}
                    strokeSelected={strokeSelected}
                    fill={fill}
                    strokeWidthNormal={strokeWidthNormal}
                    strokeWidthSelected={strokeWidthSelected}
                    shapeMode={shapeMode}
                    toImg={toImgCoords}
                    imgW={snap.width ?? img?.naturalWidth ?? 0}
                    imgH={snap.height ?? img?.naturalHeight ?? 0}
                    onHandlesDragStart={() => setDraggingVertex(true)}
                    onHandlesDragEnd={() => setDraggingVertex(false)}
                    areaLabel={areaLabel}
                  />

                  {(step === "building" || step === "modules") &&
                    selectedRoof &&
                    selectedRoofSlopeDeg > 0.05 &&
                    typeof selectedRoofFallAzimuth === "number" && (
                      <RoofAzimuthArrows
                        points={selectedRoof.points}
                        view={view}
                        azimuthDeg={selectedRoofFallAzimuth}
                        tiltDeg={selectedRoofSlopeDeg}
                        color="#39d0bc"
                        opacity={0.9}
                        stepPx={72}
                        lenPx={30}
                      />
                    )}

                  {layers.map((l) => (
                    <ZonesLayer
                      key={l.id}
                      roofId={l.id}
                      interactive={l.id === selectedId && !drawingCapturesPointer}
                      shapeMode={shapeMode}
                      toImg={toImgCoords}
                      imgW={snap.width ?? img?.naturalWidth ?? 0}
                      imgH={snap.height ?? img?.naturalHeight ?? 0}
                    />
                  ))}
                </Group>

                {/* linee protezione neve */}
                {/* linee protezione neve + label lunghezza */}
                {snowGuards.map((sg) => {
                  const midX = (sg.p1.x + sg.p2.x) / 2;
                  const midY = (sg.p1.y + sg.p2.y) / 2;
                  const isSel = sg.id === selectedSnowGuardId;
                  return (
                    <>
                      <Line
                        key={sg.id}
                        points={[sg.p1.x, sg.p1.y, sg.p2.x, sg.p2.y]}
                        stroke={isSel ? plannerTheme.panelSelected : plannerTheme.primary}
                        strokeWidth={isSel ? 2 : 1}
                        lineCap="round"
                        lineJoin="round"
                        listening={!drawingCapturesPointer}
                        onClick={(e) => {
                          e.cancelBubble = true;
                          setSelectedSnowGuard(sg.id);
                        }}
                      />
                      <Text
                        key={`${sg.id}-label`}
                        x={midX}
                        y={midY}
                        text={`${sg.lengthM?.toFixed(1)} m`}
                        fontSize={2}
                        fill={plannerTheme.textLight}
                        offsetX={6}
                        offsetY={-2}
                        listening={false}
                      />
                    </>
                  );
                })}

                {/* Draft visivo per fill-area */}
                {tool === "fill-area" && fillDraft && (
                  <Group listening={false}>
                    {/* opzionale: contorno dell’area che stai riempiendo */}
                    {fillDraft.poly?.length >= 3 && (
                      <Line
                        points={fillDraft.poly.flatMap((p) => [p.x, p.y])}
                        closed
                        stroke={plannerTheme.guideLine}
                        strokeWidth={0.8}
                        dash={[6, 4]}
                        opacity={0.6}
                        listening={false}
                      />
                    )}

                    {/* preview con i moduli REALI al 50% */}
                    <Group opacity={0.5} listening={false}>
                      {fillDraft.rects.map((r, i) => (
                        <ModuleSprite
                          key={i}
                          x={r.cx}
                          y={r.cy}
                          w={r.wPx}
                          h={r.hPx}
                          rotationDeg={r.angleDeg}
                          textureUrl="/images/panel.webp" // o il tuo textureUrl
                        />
                      ))}
                    </Group>
                  </Group>
                )}

                {(step === "modules" ||
                  (step === "building" && showPanelsInBuilding)) && (
                  <Group
                    listening={step === "modules" && !drawingCapturesPointer}
                    opacity={step === "building" ? 0.72 : 1}
                  >
                    <PanelsLayer
                      layers={layers}
                      textureUrl="/images/panel.webp"
                      selectedPanelId={
                        usePlannerV2Store.getState().selectedPanelId
                      }
                      onSelect={(id?: string) => {
                        const S = usePlannerV2Store.getState();
                        // selezione singola: aggiorna l'array di selezione (se presente nello store)
                        if (S.setSelectedPanels)
                          S.setSelectedPanels(id ? [id] : []);
                      }}
                      stageToImg={toImgCoords}
                    />
                  </Group>
                )}

              </Group>
            </Layer>
            <Layer scaleX={layerScale} scaleY={layerScale} listening={false} perfectDrawEnabled={false}>
              <Group
                x={img?.naturalWidth ? img.naturalWidth / 2 : 0}
                y={img?.naturalHeight ? img.naturalHeight / 2 : 0}
                offsetX={img?.naturalWidth ? img.naturalWidth / 2 : 0}
                offsetY={img?.naturalHeight ? img.naturalHeight / 2 : 0}
                rotation={rotateDeg}
                listening={false}
              >
                {step === "building" && (
                  <>
                    <DrawingOverlays
                      tool={tool}
                      drawingPoly={drawingPoly}
                      rectDraft={rectDraft}
                      pointerChannel={pointerChannel}
                      stroke={stroke}
                      areaLabel={areaLabel}
                      mpp={snap.mppImage}
                      roofSnapDeg={baseGridDeg}
                      canvasRotateDeg={rotateDeg}
                    />
                    <TransientDrawingPreviews
                      tool={tool}
                      snowDraft={snowDraft}
                      rectDraft={rectDraft}
                      pointer={pointerChannel}
                    />
                  </>
                )}
              </Group>
            </Layer>
          </Stage>
          <ScreenGrid
            visible={showUiGrid} // o true
            step={36}
            alpha={0.35}
            rgb="64,217,200"
            zIndex={100}
            dashed
            dash="2 4" // oppure [6, 6]
            strokeWidth={1}
          />
        </div>
      )}

      {/* Controller che emette il draft del rettangolo */}
      {step === "modules" && tool === "fill-area" && (
        <FillAreaController
          stageRef={stageRef}
          toImgCoords={toImgCoords}
          onDraftChange={setFillDraft}
          cancelVersion={fillCancelVersion}
        />
      )}
      <ToolHotkeys />

      <PanelHotkeys
        selectedPanelId={selectedPanelInstId}
        disabled={tool !== "select"}
        nudgeFromScreenDelta={(sx, sy) => {
          // usiamo il centro dello stage come punto di riferimento
          const cx = size.w / 2;
          const cy = size.h / 2;
          const p0 = toImgCoords(cx, cy);
          const p1 = toImgCoords(cx + sx, cy + sy);
          return { dx: p1.x - p0.x, dy: p1.y - p0.y };
        }}
        onDelete={(id) => {
          plannerHistory.push("delete panel");
          deletePanel(id);
          setSelectedPanelInstId(undefined);
        }}
        onDuplicate={(id) => {
          plannerHistory.push("duplicate panel");
          const nid = duplicatePanel(id);
          if (nid) setSelectedPanelInstId(nid);
        }}
      />

      <RoofHotkeys />

      <CompassHUD />

      <CanvasHotkeys />

      <RoofHudOverlay
        selectedRoof={selectedRoof}
        view={view}
        shapeMode={shapeMode}
        onToggleShape={() =>
          setShapeMode((prev) => (prev === "normal" ? "trapezio" : "normal"))
        }
        mpp={snap.mppImage}
        edgeColor={strokeSelected}
        imgW={img?.naturalWidth ?? 0}
        imgH={img?.naturalHeight ?? 0}
        rotateDeg={rotateDeg}
        canToggleShape={step !== "modules"}
      />
      {/* ORIENTATION HUD — STEALTH (improved) */}
      <div className="fixed right-3 bottom-6 z-[600] group pointer-events-none">
        <div
          className="glass-panel pointer-events-auto relative rounded-lg text-muted-foreground shadow
               backdrop-blur px-1.5 py-1 flex items-center gap-1.5 transition-all duration-150
               scale-90 opacity-70 group-hover:scale-100 group-hover:opacity-100"
          style={{ WebkitBackdropFilter: "blur(6px)" }}
        >
          {/* -10 */}
          <button
            className="glass-button-secondary h-6 min-w-6 px-1 text-[11px]"
            onClick={() => bumpRotation(-10)}
            title="Drehen -10° (Shift+[)"
          >
            −10
          </button>

          {/* -1 */}
          <button
            className="glass-button-secondary h-6 min-w-6 px-1 text-[11px]"
            onClick={() => bumpRotation(-1)}
            title="Drehen -1° ([)"
          >
            −1
          </button>

          {/* slider: più lungo, più fine, track visibile con parte riempita */}
          <input
            type="range"
            min={-180}
            max={180}
            step={0.5}
            value={rotateDeg}
            onChange={(e) => setRotateDeg(wrapDeg(parseFloat(e.target.value)))}
            className="w-36 h-1.5 mx-1 accent-primary"
            style={{
              WebkitAppearance: "none",
              appearance: "none",
              borderRadius: 9999,
              // track: base scura + progress chiaro fino a sliderPct
              background: `linear-gradient(to right, ${plannerTheme.primary} ${sliderPct}%, rgba(234,246,255,0.22) ${sliderPct}%)`,
            }}
            title="Ziehe, um zu drehen"
          />

          {/* +1 */}
          <button
            className="glass-button-secondary h-6 min-w-6 px-1 text-[11px]"
            onClick={() => bumpRotation(+1)}
            title="Drehen +1° (])"
          >
            +1
          </button>

          {/* +10 */}
          <button
            className="glass-button-secondary h-6 min-w-6 px-1 text-[11px]"
            onClick={() => bumpRotation(+10)}
            title="Drehen +10° (Shift+])"
          >
            +10
          </button>

          {/* input inline: ruota LIVE mentre digiti */}
          <div className="flex items-center gap-1 pl-1">
            <input
              type="text"
              inputMode="decimal"
              className="glass-input h-6 w-11 px-1 py-0 text-right text-[11px]"
              value={rotInput}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                setRotInput(v);
                const n = parseFloat(v);
                if (Number.isFinite(n)) setRotateDeg(wrapDeg(n));
              }}
              title="Grad (dreht in Echtzeit)"
            />
            <span className="text-[10px] text-muted-foreground">°</span>

            {/* Reset */}
            <button
              className="glass-button-secondary grid h-6 w-6 place-items-center p-0"
              onClick={() => {
                setRotateDeg(0);
                setRotInput("0");
              }}
              title="Zurücksetzen auf 0°"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* PILL hint (DE) sotto all'HUD */}
          <div className="absolute right-0 translate-y-full mt-1 pointer-events-none">
            <span className="status-badge-neutral px-2 py-0.5 text-[10px]">
              Raster ein-/ausblenden: <strong>G</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
