'use client';

import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { resolveSurfacePlanning } from '@/lib/planning-core/advanced';
import { history } from '@/components_v2/state/history';
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  buildStandardSurfacePlanning,
  resolveInitialSonnendachRoofType,
  resolveRoofModuleMode,
  resolveStandardTiltInput,
  setAdvancedQuantityMode,
} from '../advanced/advancedPlanningApplication';
import { selectAdditiveFillPanels } from './additiveFill';
import { createFillAreaDragGesture } from './fillAreaDragGesture';
import {
  buildOrientedFillAreaPolygon,
  resolveFillAreaReferenceFrame,
  type FillAreaReferenceFrame,
} from './fillAreaGeometry';

import {
  findRoofAtPoint,
  isPrimaryPointerButton,
  shouldIgnorePlannerHotkeyTarget,
} from '../../canvas/interactionPolicy';
import type { TransientFillDraftChannel } from './transientFillDraft';

type FillDraft = { a: Pt; b: Pt; poly: Pt[]; panels: PanelInstance[] };

type Props = {
  stageRef: React.RefObject<Konva.Stage | null>;
  toImgCoords: (x: number, y: number) => Pt;
  draftChannel: TransientFillDraftChannel;
  cancelVersion?: number;
};

/* -------------------------------- component -------------------------------- */
export default function FillAreaController({ stageRef, toImgCoords, draftChannel, cancelVersion = 0 }: Props) {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const draftRef = useRef<FillDraft | null>(null);
  const frameRef = useRef<FillAreaReferenceFrame | null>(null);
  const drawingRef = useRef(false);
  const candidatesRef = useRef<PanelInstance[]>([]);

  useEffect(() => {
    const st = stageRef.current?.getStage?.();
    if (!st || step !== 'modules' || tool !== 'fill-area') return;

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

    const additivePanelsFor = (poly: Pt[]) => {
      const state = usePlannerV2Store.getState();
      const roofId = state.selectedId;
      if (!roofId) return [] as PanelInstance[];
      return selectAdditiveFillPanels({
        roofId,
        areaPolygon: poly,
        candidates: candidatesRef.current,
        existingPanels: state.panels,
      });
    };
    const renderDraft = (a: Pt, b: Pt) => {
      const frame = frameRef.current;
      if (!frame) return;
      const poly = buildOrientedFillAreaPolygon({ start: a, end: b, frame });
      const panels = additivePanelsFor(poly);
      draftRef.current = { a, b, poly, panels };
      return {
        poly,
        panels,
      };
    };

    const container = st.container();
    const screenPoint = (event: PointerEvent): Pt => {
      const bounds = container.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const publishDraft = (a: Pt, b: Pt) => {
      const next = renderDraft(a, b);
      if (!next) return;
      const rects = next.panels.map((panel) => ({
        cx: panel.cx,
        cy: panel.cy,
        wPx: panel.wPx,
        hPx: panel.hPx,
        angleDeg: panel.angleDeg,
      }));
      draftChannel.publish({ a, b, poly: next.poly, rects });
    };
    let dragActivated = false;
    let activePointerId: number | null = null;
    let suppressNextClick = false;
    const gesture = createFillAreaDragGesture({
      thresholdPx: 5,
      onVisual: (visual) => {
        if (!visual) {
          draftRef.current = null;
          draftChannel.clear();
          return;
        }
        dragActivated = true;
        publishDraft(
          toImgCoords(visual.start.x, visual.start.y),
          toImgCoords(visual.end.x, visual.end.y),
        );
      },
      onCommit: () => {
        const state = usePlannerV2Store.getState();
        const roofId = state.selectedId;
        if (!roofId) return;
        // Pointer-up flushes the final visual first. Commit therefore consumes
        // the exact same canonical polygon/panels that the dashed overlay used.
        const items = draftRef.current?.panels ?? [];
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
      frameRef.current = null;
      const cancelled = gesture.cancel();
      releasePointerCapture(pointerId);
      return cancelled;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isPrimaryPointerButton(event.button) || event.isPrimary === false) return;
      const startScreen = screenPoint(event);
      const startImage = toImgCoords(startScreen.x, startScreen.y);
      const state = usePlannerV2Store.getState();
      const roof = state.layers.find((candidate) => candidate.id === state.selectedId);
      if (!roof || findRoofAtPoint(startImage, [roof])?.id !== roof.id) return;
      const candidates = buildCandidates();
      if (!candidates.mode) return;
      const resolved = resolveSurfacePlanning(roof.surfacePlanning);
      const activeDraft = state.roofPlanningDrafts[roof.id];
      const roofKind = roof.roofKind ?? (activeDraft?.targetMode === 'advanced'
        ? activeDraft.config.surface.kind
        : resolved.status === 'supported-advanced'
          ? resolved.config.surface.kind
          : resolveInitialSonnendachRoofType(roof) ??
            (candidates.mode === 'portrait' || candidates.mode === 'landscape' ? 'pitched' : 'flat')
      );
      const frame = resolveFillAreaReferenceFrame({
        roofPoints: roof.points,
        referenceEdgeIndex: roof.referenceEdgeIndex,
        roofKind,
      });
      if (!frame) return;

      candidatesRef.current = candidates.panels;
      frameRef.current = frame;
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
  }, [stageRef, step, tool, layers, selectedId, toImgCoords, draftChannel, cancelVersion]);

  return null;
}
