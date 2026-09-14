'use client';

import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import { resolveSurfacePlanning } from '@/lib/planning-core/advanced';
import { history } from '@/components_v2/state/history';
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  buildStandardSurfacePlanning,
  resolveRoofModuleMode,
  resolveStandardTiltInput,
  setAdvancedQuantityMode,
} from '../advanced/advancedPlanningApplication';
import { selectAdditiveFillPanels } from './additiveFill';
import { resolveStandardAutoLayoutCanvasAngle } from '../legacyStandardApplicationPolicy';
import { createFillAreaDragGesture } from './fillAreaDragGesture';

import {
  findRoofAtPoint,
  isPrimaryPointerButton,
  shouldIgnorePlannerHotkeyTarget,
} from '../../canvas/interactionPolicy';

type ModRect = { cx: number; cy: number; wPx: number; hPx: number; angleDeg: number };

type Props = {
  stageRef: React.RefObject<Konva.Stage | null>;
  toImgCoords: (x: number, y: number) => Pt;
  onDraftChange?: (draft: { a: Pt; b: Pt; poly: Pt[]; rects: ModRect[] } | null) => void;
  cancelVersion?: number;
};

/* --------------------------- helpers geometrici --------------------------- */
const deg2rad = (d: number) => (d * Math.PI) / 180;

function centroid(pts: Pt[]) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const dx = p.x - O.x, dy = p.y - O.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: p.x * c - p.y * s + O.x, y: p.x * s + p.y * c + O.y };
}
function axisAlignedRect(a: Pt, b: Pt): Pt[] {
  return [
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
  ];
}

/* --------------------------- griglia condivisa --------------------------- */
function gridBasics(angleDeg: number) {
  const s = usePlannerV2Store.getState();
  const roof = s.layers.find((l) => l.id === s.selectedId);
  const mpp = s.snapshot.mppImage;
  const panel = s.getSelectedPanel?.();
  const orientation = s.modules.orientation;
  if (!roof || !mpp || !panel) return null;

  const px = (m: number) => m / mpp;

  // dimensioni modulo in px (portrait/landscape) + gap in px
  let panelW = px(orientation === 'portrait' ? panel.widthM : panel.heightM);
  let panelH = px(orientation === 'portrait' ? panel.heightM : panel.widthM);
  let gapX   = px(s.modules.spacingXM ?? s.modules.spacingM);
  let gapY   = px(s.modules.spacingYM ?? s.modules.spacingM);

  // (opzionale) micro-snap per stabilità numerica
  const snap = (v: number) => Math.round(v * 10) / 10; // 0.1px
  panelW = snap(panelW);
  panelH = snap(panelH);
  gapX   = snap(gapX);
  gapY   = snap(gapY);

  const cellW = panelW + gapX;
  const cellH = panelH + gapY;

  const theta = deg2rad(angleDeg);
  const O = centroid(roof.points);

  // bounding in locale della falda, insettata dal Randabstand
  const marginPx = px(resolveRoofEdgeMarginM(roof, s.modules.marginM));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of roof.points.map((p) => worldToLocal(p, O, theta))) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX += marginPx; minY += marginPx;
  maxX -= marginPx; maxY -= marginPx;

  // rail dei CENTRI: bordo valido + metà pannello
  const startX = minX + panelW / 2;
  const startY = minY + panelH / 2;

  return {
    s, roof, panel,
    panelW, panelH, gapX, gapY, cellW, cellH,
    theta, O, minX, minY, maxX, maxY, startX, startY,
    angleDeg,
  };
}

function snapRail(v: number, start: number, step: number) {
  return Math.round((v - start) / step) * step + start;
}

// Rettangolo A→B, agganciato ai rail dei **centri**, ma espresso sui **bordi modulo**
function rectPolyFromAB(aW: Pt, bW: Pt, basics: ReturnType<typeof gridBasics>) {
  if (!basics) return [aW, bW, bW, aW];
  const { panelW, panelH, cellW, cellH, theta, O, minX, minY, maxX, maxY, startX, startY } = basics;

  const aL = worldToLocal(aW, O, theta);
  const bL = worldToLocal(bW, O, theta);

  const minCX = minX + panelW / 2, maxCX = maxX - panelW / 2;
  const minCY = minY + panelH / 2, maxCY = maxY - panelH / 2;

  const aC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(aL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(aL.y, startY, cellH))),
  };
  const bC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(bL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(bL.y, startY, cellH))),
  };

  // rettangolo in coordinate "bordi modulo"
  const x0e = Math.max(minX, Math.min(aC.x, bC.x) - panelW / 2);
  const x1e = Math.min(maxX, Math.max(aC.x, bC.x) + panelW / 2);
  const y0e = Math.max(minY, Math.min(aC.y, bC.y) - panelH / 2);
  const y1e = Math.min(maxY, Math.max(aC.y, bC.y) + panelH / 2);

  const p1 = localToWorld({ x: x0e, y: y0e }, O, theta);
  const p2 = localToWorld({ x: x1e, y: y0e }, O, theta);
  const p3 = localToWorld({ x: x1e, y: y1e }, O, theta);
  const p4 = localToWorld({ x: x0e, y: y1e }, O, theta);
  return [p1, p2, p3, p4];
}

/* -------------------------------- component -------------------------------- */
export default function FillAreaController({ stageRef, toImgCoords, onDraftChange, cancelVersion = 0 }: Props) {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);

  const draftRef = useRef<{ a: Pt; b: Pt } | null>(null);
  const drawingRef = useRef(false);
  const candidatesRef = useRef<PanelInstance[]>([]);

  useEffect(() => {
    const st = stageRef.current?.getStage?.();
    if (!st || step !== 'modules' || tool !== 'fill-area') return;

    const getAngleDeg = () => {
      const roof = layers.find((l) => l.id === selectedId);
      if (!roof) return 0;
      return resolveStandardAutoLayoutCanvasAngle({
        roofId: roof.id,
        roofPolygon: roof.points,
        legacyRoofAzimuthDeg: roof.azimuthDeg,
        gridAngleDeg: modules.gridAngleDeg,
        perRoofAngles: modules.perRoofAngles,
        referenceEdgeIndex: roof.referenceEdgeIndex,
      });
    };

    const buildCandidates = (): { mode: ReturnType<typeof resolveRoofModuleMode>; panels: PanelInstance[] } => {
      const state = usePlannerV2Store.getState();
      const roof = state.layers.find((candidate) => candidate.id === state.selectedId);
      const mppImage = state.snapshot.mppImage;
      const panel = state.getSelectedPanel();
      const mode = resolveRoofModuleMode({ roof, roofId: roof?.id, panels: state.panels, draft: roof ? state.roofPlanningDrafts[roof.id] : undefined });
      if (!roof || !mppImage || !panel || !mode) return { mode, panels: [] };
      const runId = `fill-${nanoid()}`;
      const draft = state.roofPlanningDrafts[roof.id];
      const resolved = resolveSurfacePlanning(roof.surfacePlanning);

      if (mode === 'portrait' || mode === 'landscape') {
        const standardDraft = draft?.targetMode === 'standard' ? draft : undefined;
        const selectedPanel = standardDraft
          ? state.catalogPanels.find((candidate) => candidate.id === standardDraft.panelSpecId)
          : panel;
        if (!selectedPanel) return { mode, panels: [] };
        const generated = buildDirectStandardRoofLayout({
          roof,
          panel: selectedPanel,
          modules: standardDraft?.modules ?? state.modules,
          orientation: mode,
          moduleTilt: standardDraft?.moduleTilt ?? resolveStandardTiltInput(roof.surfacePlanning),
          mppImage,
          zones: state.zones,
          snowGuards: state.snowGuards,
          thermalFieldLimits: standardDraft?.thermalFieldLimits ??
            (resolved.status === 'supported-standard' ? resolved.config.thermalFieldLimits : undefined),
          createPanelId: (index) => `${roof.id}_${runId}_${index}`,
          alignmentMode: 'current',
        });
        return { mode, panels: generated?.panels ?? [] };
      }

      const config = draft?.targetMode === 'advanced'
        ? draft.config
        : resolved.status === 'supported-advanced'
          ? resolved.config
          : undefined;
      if (!config) return { mode, panels: [] };
      const generated = buildDirectAdvancedRoofLayout({
        roof,
        // F fills available grid positions; a persisted fixed quantity must
        // not artificially restrict the additive candidate pool.
        config: setAdvancedQuantityMode({ config, mode: 'auto' }),
        mppImage,
        zones: state.zones,
        snowGuards: state.snowGuards,
        layoutRunId: runId,
        createPanelId: (index) => `${roof.id}_${runId}_${index}`,
      });
      return { mode, panels: generated?.panels ?? [] };
    };

    const selectionFor = (a: Pt, b: Pt, mode: ReturnType<typeof resolveRoofModuleMode>) => {
      if (mode === 'portrait' || mode === 'landscape') {
        return rectPolyFromAB(a, b, gridBasics(getAngleDeg()));
      }
      return axisAlignedRect(a, b);
    };

    const additivePanelsFor = (a: Pt, b: Pt) => {
      const state = usePlannerV2Store.getState();
      const roofId = state.selectedId;
      const roof = state.layers.find((candidate) => candidate.id === roofId);
      const mode = resolveRoofModuleMode({ roof, roofId, panels: state.panels, draft: roofId ? state.roofPlanningDrafts[roofId] : undefined });
      if (!roofId || !mode) return { poly: axisAlignedRect(a, b), panels: [] as PanelInstance[] };
      const poly = selectionFor(a, b, mode);
      return {
        poly,
        panels: selectAdditiveFillPanels({
          roofId,
          areaPolygon: poly,
          candidates: candidatesRef.current,
          existingPanels: state.panels,
        }),
      };
    };

    const container = st.container();
    const screenPoint = (event: PointerEvent): Pt => {
      const bounds = container.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const renderDraft = (a: Pt, b: Pt) => {
      draftRef.current = { a, b };
      const next = additivePanelsFor(a, b);
      const rects = next.panels.map((panel) => ({
        cx: panel.cx,
        cy: panel.cy,
        wPx: panel.wPx,
        hPx: panel.hPx,
        angleDeg: panel.angleDeg,
      }));
      onDraftChange?.({ a, b, poly: next.poly, rects });
    };
    let dragActivated = false;
    let activePointerId: number | null = null;
    let suppressNextClick = false;
    const gesture = createFillAreaDragGesture({
      thresholdPx: 5,
      onVisual: (visual) => {
        if (!visual) {
          draftRef.current = null;
          onDraftChange?.(null);
          return;
        }
        dragActivated = true;
        renderDraft(
          toImgCoords(visual.start.x, visual.start.y),
          toImgCoords(visual.end.x, visual.end.y),
        );
      },
      onCommit: (visual) => {
        const a = toImgCoords(visual.start.x, visual.start.y);
        const b = toImgCoords(visual.end.x, visual.end.y);
        const state = usePlannerV2Store.getState();
        const roofId = state.selectedId;
        if (!roofId) return;
        const items = additivePanelsFor(a, b).panels;
        if (items.length > 0) {
          history.push('Manuell füllen');
          state.appendPanelsToRoof({ roofId, panels: items });
          const activeDraft = state.roofPlanningDrafts[roofId];
          const roof = state.layers.find((candidate) => candidate.id === roofId);
          if (activeDraft?.targetMode === 'advanced') {
            state.setCommittedSurfacePlanning(roofId, activeDraft.config);
            state.clearRoofPlanningDraft(roofId);
          } else if (activeDraft?.targetMode === 'standard' && roof) {
            state.setCommittedSurfacePlanning(roofId, buildStandardSurfacePlanning({
              roof,
              moduleTilt: activeDraft.moduleTilt,
              moduleLayoutMode: activeDraft.modules.orientation,
              thermalFieldLimits: activeDraft.thermalFieldLimits,
            }));
            state.clearRoofPlanningDraft(roofId);
          }
          toast.success(`${items.length} ${items.length === 1 ? 'Modul hinzugefügt' : 'Module hinzugefügt'}`);
        } else {
          toast('In diesem Bereich können keine weiteren Module platziert werden.');
        }
      },
    });

    const releasePointerCapture = (pointerId: number | null) => {
      if (pointerId == null || !container.hasPointerCapture?.(pointerId)) return;
      try {
        container.releasePointerCapture(pointerId);
      } catch {
        // The gesture is already safely finalized even if capture was lost.
      }
    };
    const cancelGesture = () => {
      const pointerId = activePointerId;
      activePointerId = null;
      drawingRef.current = false;
      dragActivated = false;
      candidatesRef.current = [];
      const cancelled = gesture.cancel();
      releasePointerCapture(pointerId);
      return cancelled;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isPrimaryPointerButton(event.button) || event.isPrimary === false) return;
      const startScreen = screenPoint(event);
      const startImage = toImgCoords(startScreen.x, startScreen.y);
      const roof = layers.find((candidate) => candidate.id === selectedId);
      if (!roof || findRoofAtPoint(startImage, [roof])?.id !== roof.id) return;
      const candidates = buildCandidates();
      if (!candidates.mode) return;

      candidatesRef.current = candidates.panels;
      drawingRef.current = true;
      dragActivated = false;
      activePointerId = event.pointerId;
      gesture.begin(startScreen);
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        // Window listeners still complete/cancel the gesture without capture.
      }
      container.focus();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId || !gesture.move(screenPoint(event))) return;
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      const pointerId = activePointerId;
      const shouldSuppressClick = dragActivated;
      activePointerId = null;
      gesture.end(screenPoint(event));
      drawingRef.current = false;
      candidatesRef.current = [];
      suppressNextClick = shouldSuppressClick || dragActivated;
      dragActivated = false;
      releasePointerCapture(pointerId);
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      cancelGesture();
    };
    const onLostPointerCapture = (event: PointerEvent) => {
      if (event.pointerId === activePointerId) cancelGesture();
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        shouldIgnorePlannerHotkeyTarget(event.target) ||
        shouldIgnorePlannerHotkeyTarget(document.activeElement) ||
        !cancelGesture()
      ) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('click', onClickCapture, { capture: true });
    container.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    window.addEventListener('keydown', onEscape, { capture: true });
    window.addEventListener('blur', cancelGesture);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('click', onClickCapture, { capture: true });
      container.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      window.removeEventListener('keydown', onEscape, { capture: true });
      window.removeEventListener('blur', cancelGesture);
      cancelGesture();
    };
  }, [stageRef, step, tool, layers, selectedId, modules.gridAngleDeg, modules.perRoofAngles, toImgCoords, onDraftChange, cancelVersion]);

  return null;
}
