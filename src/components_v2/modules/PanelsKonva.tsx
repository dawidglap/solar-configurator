// src/components_v2/canvas/PanelsKonva.tsx
'use client';

import React from 'react';
import { Group } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import {
  usePanelDragSnap,
  buildPanelDragStaticGeometry,
  createPanelAxis,
  createPanelDragSpatialIndex,
  panelSnapTuningForScale,
  resolvePanelDragFrameUV,
  type PanelInst as HookPanel,
  type PanelSnapGuide,
} from '../modules/panels/usePanelDragSnap';
import { PanelItem } from './panels/PanelItem';
import { Guides } from './panels/Guides';
import { createLatestFrameScheduler, type FrameScheduler } from '../canvas/performance/latestFrameScheduler';
import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import type { PanelInstance } from '@/types/planner';
import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from '@/lib/planning-core/advanced';
import {
  buildAdvancedManualSnapCenters,
  createPanelPastePlacementValidator,
  resolveAdvancedManualCenterSnap,
  resolveManualAdvancedBlockDefinition,
  type AdvancedManualSnapGuide,
} from './manualPlacement';
import { history as plannerHistory } from '../state/history';
import MultiSelectionDragHandle from './panels/MultiSelectionDragHandle';
import { resolveDirectLayoutTargets } from './panels/directLayoutGeometry';
import {
  PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  resolveOutwardBlockArrowAzimuths,
} from './panels/moduleSlope';
import {
  isPrimaryPointerButton,
  resolveRoofLocalPointerAction,
} from '../canvas/interactionPolicy';

const HANDLE_GAP_STAGE_PX = 28;     // distanza sotto al gruppo (px schermo)

type PanelInst = HookPanel & PanelInstance;



export default function PanelsKonva(props: {
  roofId: string;
  roofPolygon: Pt[];
  textureUrl?: string;
  selectedPanelId?: string;               // legacy compat (fallback)
  onSelect?: (id?: string, opts?: { additive?: boolean }) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  stageToImg?: (x: number, y: number) => Pt; // Stage → Img
  canvasRotationDeg: number;
}) {
  const {
    roofId,
    roofPolygon,
    textureUrl,
    selectedPanelId,
    onSelect,
    onDragStart,
    onDragEnd,
    stageToImg,
    canvasRotationDeg,
  } = props;

  // --- store
  const allPanels = usePlannerV2Store((s) => s.panels) as PanelInst[];
  const hasPlanningDraft = usePlannerV2Store((s) => Boolean(s.roofPlanningDrafts[roofId]));
  const updatePanelsBulk = usePlannerV2Store((s) => s.updatePanelsBulk);
  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);
  const allZones = usePlannerV2Store((s) => s.zones);
  const snowGuards = usePlannerV2Store((s) => s.snowGuards);
  const panels = React.useMemo(
    () => allPanels.filter((p) => p.roofId === roofId),
    [allPanels, roofId]
  );
  const opposingArrowAzimuths = React.useMemo(() => {
    const opposing = panels.filter((panel) =>
      panel.advanced?.systemId === K2_D_DOME_SYSTEM_ID ||
      panel.advanced?.systemId === GENERIC_EAST_WEST_SYSTEM_ID,
    );
    return resolveOutwardBlockArrowAzimuths(opposing.map((panel) => ({
      id: panel.id,
      blockKey: panel.advanced?.blockKey,
      cx: panel.cx,
      cy: panel.cy,
    })));
  }, [panels]);

  const routePanelPointerDown = React.useCallback((_panelId: string, event: any) => {
    const state = usePlannerV2Store.getState();
    const action = resolveRoofLocalPointerAction({
      ownerRoofId: roofId,
      selectedRoofId: state.selectedId,
      button: event?.evt?.button,
      tool: state.tool,
    });
    if (action === 'ignore-non-primary') return 'ignore' as const;
    if (action === 'preserve-explicit-tool') return 'ignore' as const;
    if (action === 'switch-roof') {
      state.select(roofId);
      return 'consume' as const;
    }
    return 'continue' as const;
  }, [roofId]);


  // multiselezione
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds || []);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const [directDragActive, setDirectDragActive] = React.useState(false);
  const handleDirectDragStart = React.useCallback(() => {
    setDirectDragActive(true);
    onDragStart?.();
  }, [onDragStart]);
  const handleDirectDragEnd = React.useCallback(() => {
    setDirectDragActive(false);
    onDragEnd?.();
  }, [onDragEnd]);

  // scale corrente
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);
  const invScale = 1 / (stageScale || 1);
  const snapTuningImg = React.useMemo(() => panelSnapTuningForScale(stageScale), [stageScale]);

  // margine progetto → px immagine
  const marginM = usePlannerV2Store((s) => {
    const roof = s.layers.find((item) => item.id === roofId);
    return roof ? resolveRoofEdgeMarginM(roof, s.modules.marginM) : s.modules.marginM;
  }) ?? 0;
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage) ?? 1;
  const spacingM = usePlannerV2Store((s) => s.modules.spacingM) ?? 0;
  const spacingXM = usePlannerV2Store((s) => s.modules.spacingXM) ?? spacingM;
  const spacingYM = usePlannerV2Store((s) => s.modules.spacingYM) ?? spacingM;
  const gapPx = React.useMemo(() => (mpp ? spacingM / mpp : 0), [spacingM, mpp]);
  const gapXPx = React.useMemo(() => (mpp ? spacingXM / mpp : 0), [spacingXM, mpp]);
  const gapYPx = React.useMemo(() => (mpp ? spacingYM / mpp : 0), [spacingYM, mpp]);

  // texture pannello (opzionale)
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // clip falda
  const clipFunc = React.useCallback((ctx: any) => {
    if (!roofPolygon.length) return;
    ctx.beginPath();
    ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
    for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
    ctx.closePath();
  }, [roofPolygon]);

  // angolo falda => defaultAngleDeg
  const roof = usePlannerV2Store((s) => s.layers.find((l) => l.id === roofId));
  const committedAdvancedConfig = React.useMemo(() => {
    const persisted = resolveSurfacePlanning(roof?.surfacePlanning);
    return persisted.status === 'supported-advanced' ? persisted.config : null;
  }, [roof?.surfacePlanning]);
  const isPitchedRoof = React.useMemo(() => {
    if (!roof) return undefined;
    return roof.roofKind === 'pitched' ||
      (roof.roofKind == null && committedAdvancedConfig == null);
  }, [committedAdvancedConfig, roof]);
  const committedAdvancedDefinition = React.useMemo(
    () => committedAdvancedConfig ? resolveManualAdvancedBlockDefinition(committedAdvancedConfig) : null,
    [committedAdvancedConfig],
  );
  const roofAzimuthDeg = roof?.azimuthDeg;
  const polyAngleDeg = React.useMemo(() => (longestEdgeAngle(roofPolygon) * 180) / Math.PI, [roofPolygon]);
  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);
  const preparePanelValidator = React.useCallback((id: string) => {
    const panel = allPanels.find((candidate) => candidate.id === id);
    if (!panel || !roof) return undefined;
    const placementIsValid = createPanelPastePlacementValidator({
      roof,
      marginM,
      mppImage: mpp,
      zones: allZones,
      snowGuards,
      panels: allPanels,
      excludePanelIds: new Set([id]),
      moduleGapXM: spacingXM,
      moduleGapYM: spacingYM,
    });
    return (proposedCx: number, proposedCy: number): boolean => placementIsValid([
      { ...panel, cx: proposedCx, cy: proposedCy },
    ]);
  }, [allPanels, allZones, marginM, mpp, roof, snowGuards, spacingXM, spacingYM]);

  const commitPanel = React.useCallback(
    (id: string, patch: Partial<PanelInst>) => {
      const panel = allPanels.find((p) => p.id === id);
      if (!panel) return;
      const validate = preparePanelValidator(id);
      const cx = patch.cx ?? panel.cx;
      const cy = patch.cy ?? panel.cy;
      if (!validate?.(cx, cy)) return;

      plannerHistory.push('move panel');
      updatePanelsBulk({
        [id]: { ...patch, cx, cy },
      });
    },
    [allPanels, preparePanelValidator, updatePanelsBulk]
  );



  // drag singolo (immutato)
  const { startDrag, hintURef, hintVRef } = usePanelDragSnap({
    defaultAngleDeg,
    allPanels,
    roofId,
    stageToImg,
    commitPanel,
    onSelect,
    onDragStart: handleDirectDragStart,
    onDragEnd: handleDirectDragEnd,
    snapTuningImg,
    gapPx,
    gapXPx,
    gapYPx,
    prepareValidateCandidate: preparePanelValidator,
  });


  // selected panels (incl. compat singola)
  const useLegacySingle =
    (!selectedIds || selectedIds.length === 0) && typeof selectedPanelId === 'string';
  const selectedPanels = React.useMemo(() => {
    if (useLegacySingle) return panels.filter((p) => p.id === selectedPanelId);
    if (!selectedIds.length) return [];
    return resolveDirectLayoutTargets({
      panels,
      selectedPanelIds: selectedIds,
      roofId,
    }) as PanelInst[];
  }, [panels, roofId, selectedIds, useLegacySingle, selectedPanelId]);

  // bbox gruppo (per handle)
  const groupBBox = React.useMemo(() => {
    if (selectedPanels.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of selectedPanels) {
      const angle = typeof p.angleDeg === 'number' ? p.angleDeg : defaultAngleDeg;
      const t = (angle * Math.PI) / 180;
      const c = Math.cos(t), s = Math.sin(t);
      const hx = p.wPx / 2, hy = p.hPx / 2;
      const corners = [
        { x: -hx, y: -hy }, { x: +hx, y: -hy }, { x: +hx, y: +hy }, { x: -hx, y: +hy },
      ].map(q => ({ x: p.cx + q.x * c - q.y * s, y: p.cy + q.x * s + q.y * c }));
      for (const q of corners) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedPanels, defaultAngleDeg]);

  // Guide imperative: nessun render React durante il drag di gruppo.
  const groupHintURef = React.useRef<import('konva/lib/shapes/Line').Line | null>(null);
  const groupHintVRef = React.useRef<import('konva/lib/shapes/Line').Line | null>(null);
  const setGroupGuide = React.useCallback((
    ref: React.MutableRefObject<import('konva/lib/shapes/Line').Line | null>,
    points: number[] | null,
  ) => {
    ref.current?.points(points ?? []);
    ref.current?.visible(Boolean(points));
  }, []);
  const clearGroupGuides = React.useCallback(() => {
    setGroupGuide(groupHintURef, null);
    setGroupGuide(groupHintVRef, null);
  }, [setGroupGuide]);
  const [groupDragActive, setGroupDragActive] = React.useState(false);

  // stato drag di gruppo
  const dragStateRef = React.useRef<{
    stage: any;
    startImg: Pt;
    inProgress: boolean;
    init: { id: string; cx: number; cy: number; u: number; v: number; opacity: number }[];
    anchorId: string;
    groupCenterUV: { u: number; v: number };
    groupHalfSize: { hw: number; hh: number };
    axis: ReturnType<typeof createPanelAxis>;
    spatialIndex: ReturnType<typeof createPanelDragSpatialIndex>;
    activeSnapKey: string | null;
    nodes: Map<string, any>;
    selectionNodes: Map<string, any>;
    slopeArrowNodes: Map<string, any>;
    handleNode: any | null;
    handleInitial: Pt | null;
    captureTarget: Element | null;
    pointerId: number | null;
    onLostPointerCapture: (() => void) | null;
    onWindowBlur: (() => void) | null;
    final: { id: string; cx: number; cy: number }[] | null;
    advancedSnap: {
      definition: NonNullable<typeof committedAdvancedDefinition>;
      initialCenter: Pt;
      otherPanels: PanelInst[];
      spatialIndex: ReturnType<typeof createPanelDragSpatialIndex>;
    } | null;
    placementIsValid: (panels: readonly PanelInstance[]) => boolean;
    frame: FrameScheduler<{ point: Pt; disableSnap: boolean }>;
  } | null>(null);

  const detachGroupDragInput = React.useCallback((state: NonNullable<typeof dragStateRef.current>) => {
    state.stage.off('.groupDrag');
    if (state.captureTarget && state.onLostPointerCapture) {
      state.captureTarget.removeEventListener('lostpointercapture', state.onLostPointerCapture);
    }
    if (state.onWindowBlur) window.removeEventListener('blur', state.onWindowBlur);
    if (
      state.captureTarget &&
      state.pointerId != null &&
      'hasPointerCapture' in state.captureTarget &&
      'releasePointerCapture' in state.captureTarget
    ) {
      const target = state.captureTarget as Element & {
        hasPointerCapture(pointerId: number): boolean;
        releasePointerCapture(pointerId: number): void;
      };
      if (target.hasPointerCapture(state.pointerId)) target.releasePointerCapture(state.pointerId);
    }
  }, []);

  const cancelGroupDrag = React.useCallback(() => {
    const state = dragStateRef.current;
    if (!state) return false;
    detachGroupDragInput(state);
    state.frame.cancel();
    state.init.forEach((initial) => {
      const node = state.nodes.get(initial.id);
      node?.position({ x: initial.cx, y: initial.cy });
      node?.opacity(initial.opacity);
      state.selectionNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
      state.slopeArrowNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
    });
    if (state.handleNode && state.handleInitial) state.handleNode.position(state.handleInitial);
    state.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
    dragStateRef.current = null;
    clearGroupGuides();
    setGroupDragActive(false);
    const container = state.stage.container?.();
    if (container) container.style.cursor = 'default';
    handleDirectDragEnd();
    return true;
  }, [clearGroupGuides, detachGroupDragInput, handleDirectDragEnd]);

  React.useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !cancelGroupDrag()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onWindowBlur = () => cancelGroupDrag();
    window.addEventListener('keydown', onEscape, { capture: true });
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onEscape, { capture: true });
      window.removeEventListener('blur', onWindowBlur);
      cancelGroupDrag();
    };
  }, [cancelGroupDrag]);

  const beginGroupDrag = React.useCallback((
    e: any,
    movingPanels: PanelInst[] = selectedPanels,
    handleNode: any | null = null,
  ) => {
    if (movingPanels.length < 1 || !stageToImg) return;

    const stage = e.target.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!stage || !pos) return;
    const activeHandleNode = handleNode ?? stage.findOne('.panel-selection-drag-handle') ?? null;

    const startImg = stageToImg(pos.x, pos.y);
    const nativeEvent = e?.evt as PointerEvent | undefined;
    nativeEvent?.preventDefault?.();
    const eventTarget = nativeEvent?.target;
    const captureTarget = eventTarget instanceof Element && 'setPointerCapture' in eventTarget
      ? eventTarget
      : stage.container?.() ?? null;
    const pointerId = typeof nativeEvent?.pointerId === 'number' ? nativeEvent.pointerId : null;
    if (captureTarget && pointerId != null && 'setPointerCapture' in captureTarget) {
      try {
        (captureTarget as Element & { setPointerCapture(pointerId: number): void }).setPointerCapture(pointerId);
      } catch {
        // Konva continues receiving pointer events even when capture is unavailable.
      }
    }

    // A rigid selection uses the actual working angle of its first member.
    const anchor = movingPanels[0];
    const workingAngleDeg = typeof anchor.angleDeg === 'number' ? anchor.angleDeg : defaultAngleDeg;
    const axis = createPanelAxis(workingAngleDeg);

    const nodes = new Map<string, any>();
    const selectionNodes = new Map<string, any>();
    const slopeArrowNodes = new Map<string, any>();
    movingPanels.forEach((panel) => {
      const node = stage.findOne(`#panel-node-${panel.id}`);
      if (node) nodes.set(panel.id, node);
      const selectionNode = stage.findOne(`#panel-selection-${panel.id}`);
      if (selectionNode) selectionNodes.set(panel.id, selectionNode);
      const slopeArrowNode = stage.findOne(`#panel-slope-arrow-${panel.id}`);
      if (slopeArrowNode) slopeArrowNodes.set(panel.id, slopeArrowNode);
    });

    const movingIds = new Set(movingPanels.map((panel) => panel.id));
    const placementIsValid = roof
      ? createPanelPastePlacementValidator({
          roof,
          marginM,
          mppImage: mpp,
          zones: allZones,
          snowGuards,
          panels: allPanels,
          excludePanelIds: movingIds,
          moduleGapXM: spacingXM,
          moduleGapYM: spacingYM,
        })
      : () => false;
    const staticPanelsUV = buildPanelDragStaticGeometry({
      allPanels,
      roofId,
      excludeIds: movingIds,
      defaultAngleDeg,
      axisAngleDeg: workingAngleDeg,
      project: axis.project,
    });
    const projectedMoving = movingPanels.map((panel) => {
      const center = axis.project({ x: panel.cx, y: panel.cy });
      const angleRad = (typeof panel.angleDeg === 'number' ? panel.angleDeg : defaultAngleDeg) * Math.PI / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const corners = [
        { x: -panel.wPx / 2, y: -panel.hPx / 2 },
        { x: panel.wPx / 2, y: -panel.hPx / 2 },
        { x: panel.wPx / 2, y: panel.hPx / 2 },
        { x: -panel.wPx / 2, y: panel.hPx / 2 },
      ].map((corner) => axis.project({
        x: panel.cx + corner.x * cos - corner.y * sin,
        y: panel.cy + corner.x * sin + corner.y * cos,
      }));
      return {
        panel,
        center,
        minU: Math.min(...corners.map((corner) => corner.u)),
        maxU: Math.max(...corners.map((corner) => corner.u)),
        minV: Math.min(...corners.map((corner) => corner.v)),
        maxV: Math.max(...corners.map((corner) => corner.v)),
      };
    });
    const minU = Math.min(...projectedMoving.map((item) => item.minU));
    const maxU = Math.max(...projectedMoving.map((item) => item.maxU));
    const minV = Math.min(...projectedMoving.map((item) => item.minV));
    const maxV = Math.max(...projectedMoving.map((item) => item.maxV));
    const groupCenterUV = { u: (minU + maxU) / 2, v: (minV + maxV) / 2 };
    const groupHalfSize = { hw: (maxU - minU) / 2, hh: (maxV - minV) / 2 };
    const largestExtent = staticPanelsUV.reduce(
      (largest, panel) => Math.max(largest, panel.hw * 2, panel.hh * 2),
      Math.max(groupHalfSize.hw * 2, groupHalfSize.hh * 2),
    );
    const spatialIndex = createPanelDragSpatialIndex(
      staticPanelsUV,
      Math.max(32, largestExtent + snapTuningImg.adjacencyReleasePx * 3),
    );
    const movingBlockKey = movingPanels[0]?.advanced?.blockKey;
    const isCompleteAdvancedBlock = Boolean(
      movingBlockKey &&
      committedAdvancedDefinition &&
      movingPanels.every((panel) => panel.advanced?.blockKey === movingBlockKey) &&
      panels.filter((panel) => panel.advanced?.blockKey === movingBlockKey).length === movingPanels.length,
    );
    const advancedSnap = isCompleteAdvancedBlock && committedAdvancedDefinition
      ? (() => {
          const otherPanels = allPanels.filter((panel) => !movingIds.has(panel.id));
          const centers = buildAdvancedManualSnapCenters({ roofId, panels: otherPanels });
          return {
          definition: committedAdvancedDefinition,
          initialCenter: {
            x: movingPanels.reduce((sum, panel) => sum + panel.cx, 0) / movingPanels.length,
            y: movingPanels.reduce((sum, panel) => sum + panel.cy, 0) / movingPanels.length,
          },
          otherPanels,
          spatialIndex: createPanelDragSpatialIndex(
            centers.map((center) => ({
              id: center.blockKey,
              u: center.x,
              v: center.y,
              hw: 0,
              hh: 0,
            })),
            Math.max(32, snapTuningImg.adjacencyReleasePx * 2),
          ),
        };
        })()
      : null;

    const onFrame = ({ point: curImg, disableSnap }: { point: Pt; disableSnap: boolean }) => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const dImgX = curImg.x - st.startImg.x;
      const dImgY = curImg.y - st.startImg.y;

      const anchorInit = st.init.find(i => i.id === st.anchorId)!;
      const deltaUV = st.axis.project({ x: dImgX, y: dImgY });
      const freeCenterUV = {
        u: st.groupCenterUV.u + deltaUV.u,
        v: st.groupCenterUV.v + deltaUV.v,
      };
      const positionsForCenter = (center: { u: number; v: number }) => {
        const du = center.u - st.groupCenterUV.u;
        const dv = center.v - st.groupCenterUV.v;
        return st.init.map((initial) => {
          const next = st.axis.fromUV(initial.u + du, initial.v + dv);
          return { id: initial.id, cx: next.x, cy: next.y, opacity: initial.opacity };
        });
      };
      const panelsForPositions = (positions: { id: string; cx: number; cy: number }[]) => positions.map((position) => {
        const panel = panels.find((candidate) => candidate.id === position.id)!;
        return { ...panel, cx: position.cx, cy: position.cy };
      });
      const validateCenter = (center: { u: number; v: number }) =>
        st.placementIsValid(panelsForPositions(positionsForCenter(center)));

      let resolvedCenterUV = freeCenterUV;
      let valid = validateCenter(freeCenterUV);
      let hintU = false;
      let hintV = false;
      let snapGuides: PanelSnapGuide[] = [];
      let advancedGuidePoints: AdvancedManualSnapGuide[] = [];
      if (st.advancedSnap) {
        const rawCenter = {
          x: st.advancedSnap.initialCenter.x + dImgX,
          y: st.advancedSnap.initialCenter.y + dImgY,
        };
        const maximumPitchPx = Math.max(
          st.advancedSnap.definition.pitchM.x,
          st.advancedSnap.definition.pitchM.y,
        ) / Math.max(mpp, 1e-9);
        const nearbyCenters = st.advancedSnap.spatialIndex.query(
          rawCenter.x,
          rawCenter.y,
          maximumPitchPx + snapTuningImg.adjacencyReleasePx,
        ).map((center) => ({ blockKey: center.id, x: center.u, y: center.v }));
        const advancedResolution = resolveAdvancedManualCenterSnap({
          pointerPx: rawCenter,
          roofId,
          panels: st.advancedSnap.otherPanels,
          centers: nearbyCenters,
          definition: st.advancedSnap.definition,
          mppImage: mpp,
          activationThresholdPx: snapTuningImg.adjacencyActivationPx,
          releaseThresholdPx: snapTuningImg.adjacencyReleasePx,
          activeSnapKey: st.activeSnapKey,
          disableSnap,
          validateCandidate: (candidateCenter) => {
            const candidateDeltaUV = st.axis.project({
              x: candidateCenter.x - st.advancedSnap!.initialCenter.x,
              y: candidateCenter.y - st.advancedSnap!.initialCenter.y,
            });
            return validateCenter({
              u: st.groupCenterUV.u + candidateDeltaUV.u,
              v: st.groupCenterUV.v + candidateDeltaUV.v,
            });
          },
        });
        st.activeSnapKey = advancedResolution.snapKey;
        const snappedCenter = advancedResolution.position;
        const snappedDelta = {
          x: snappedCenter.x - st.advancedSnap.initialCenter.x,
          y: snappedCenter.y - st.advancedSnap.initialCenter.y,
        };
        const snappedDeltaUV = st.axis.project(snappedDelta);
        const advancedCenterUV = {
          u: st.groupCenterUV.u + snappedDeltaUV.u,
          v: st.groupCenterUV.v + snappedDeltaUV.v,
        };
        if (advancedResolution.snapped) {
          resolvedCenterUV = advancedCenterUV;
          valid = true;
          advancedGuidePoints = advancedResolution.guides;
        }
      } else {
        const nearby = st.spatialIndex.query(
          freeCenterUV.u,
          freeCenterUV.v,
          Math.max(st.groupHalfSize.hw, st.groupHalfSize.hh) * 2 + snapTuningImg.adjacencyReleasePx,
        );
        const resolution = resolvePanelDragFrameUV({
          free: freeCenterUV,
          hw: st.groupHalfSize.hw,
          hh: st.groupHalfSize.hh,
          gapXPx: gapXPx ?? gapPx,
          gapYPx: gapYPx ?? gapPx,
          activationThresholdPx: snapTuningImg.adjacencyActivationPx,
          releaseThresholdPx: snapTuningImg.adjacencyReleasePx,
          snapTuning: snapTuningImg,
          disableSnap,
          activeSnapKey: st.activeSnapKey,
          panels: nearby,
          allowMismatchedAdjacency: true,
          validate: validateCenter,
        });
        st.activeSnapKey = resolution.snapKey;
        resolvedCenterUV = resolution.position;
        valid = resolution.valid;
        hintU = resolution.hintU;
        hintV = resolution.hintV;
        snapGuides = resolution.guides;
      }

      const proposed = positionsForCenter(resolvedCenterUV);
      st.final = valid ? proposed : null;
      const columnGuide = snapGuides.find((guide) => guide.axis === 'column');
      const advancedColumnGuide = advancedGuidePoints.find((guide) => guide.axis === 'column');
      if (advancedColumnGuide) {
        setGroupGuide(groupHintURef, [
          advancedColumnGuide.points[0].x, advancedColumnGuide.points[0].y,
          advancedColumnGuide.points[1].x, advancedColumnGuide.points[1].y,
        ]);
      } else if (columnGuide) {
        const a = st.axis.fromUV(columnGuide.coordinate, columnGuide.start);
        const b = st.axis.fromUV(columnGuide.coordinate, columnGuide.end);
        setGroupGuide(groupHintURef, [a.x, a.y, b.x, b.y]);
      } else if (hintU) {
        const extent = Math.max(st.groupHalfSize.hh * 2, 1);
        const a = st.axis.fromUV(resolvedCenterUV.u, resolvedCenterUV.v - extent);
        const b = st.axis.fromUV(resolvedCenterUV.u, resolvedCenterUV.v + extent);
        setGroupGuide(groupHintURef, [a.x, a.y, b.x, b.y]);
      } else setGroupGuide(groupHintURef, null);
      const rowGuide = snapGuides.find((guide) => guide.axis === 'row');
      const advancedRowGuide = advancedGuidePoints.find((guide) => guide.axis === 'row');
      if (advancedRowGuide) {
        setGroupGuide(groupHintVRef, [
          advancedRowGuide.points[0].x, advancedRowGuide.points[0].y,
          advancedRowGuide.points[1].x, advancedRowGuide.points[1].y,
        ]);
      } else if (rowGuide) {
        const a = st.axis.fromUV(rowGuide.start, rowGuide.coordinate);
        const b = st.axis.fromUV(rowGuide.end, rowGuide.coordinate);
        setGroupGuide(groupHintVRef, [a.x, a.y, b.x, b.y]);
      } else if (hintV) {
        const extent = Math.max(st.groupHalfSize.hw * 2, 1);
        const a = st.axis.fromUV(resolvedCenterUV.u - extent, resolvedCenterUV.v);
        const b = st.axis.fromUV(resolvedCenterUV.u + extent, resolvedCenterUV.v);
        setGroupGuide(groupHintVRef, [a.x, a.y, b.x, b.y]);
      } else setGroupGuide(groupHintVRef, null);
      proposed.forEach((position) => {
        const node = st.nodes.get(position.id);
        node?.position({ x: position.cx, y: position.cy });
        node?.opacity(valid ? position.opacity : 0.58);
        st.selectionNodes.get(position.id)?.position({ x: position.cx, y: position.cy });
        st.slopeArrowNodes.get(position.id)?.position({ x: position.cx, y: position.cy });
      });
      if (st.handleNode && st.handleInitial) {
        const anchorPosition = proposed.find((position) => position.id === st.anchorId);
        if (anchorPosition) {
          st.handleNode.position({
            x: st.handleInitial.x + anchorPosition.cx - anchorInit.cx,
            y: st.handleInitial.y + anchorPosition.cy - anchorInit.cy,
          });
        }
      }
      st.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
    };

    const frame = createLatestFrameScheduler(onFrame);
    dragStateRef.current = {
      stage,
      startImg,
      inProgress: true,
      init: movingPanels.map(p => {
        const uv = axis.project({ x: p.cx, y: p.cy });
        return {
          id: p.id,
          cx: p.cx,
          cy: p.cy,
          u: uv.u,
          v: uv.v,
          opacity: nodes.get(p.id)?.opacity?.() ?? 1,
        };
      }),
      anchorId: anchor.id,
      groupCenterUV,
      groupHalfSize,
      axis,
      spatialIndex,
      activeSnapKey: null,
      nodes,
      selectionNodes,
      slopeArrowNodes,
      handleNode: activeHandleNode,
      handleInitial: activeHandleNode
        ? { x: activeHandleNode.x(), y: activeHandleNode.y() }
        : null,
      captureTarget,
      pointerId,
      onLostPointerCapture: null,
      onWindowBlur: null,
      final: null,
      advancedSnap,
      placementIsValid,
      frame,
    };

    const ns = '.groupDrag';
    clearGroupGuides();

    const onMove = (event: any) => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const pt = st.stage.getPointerPosition();
      if (!pt) return;
      st.frame.schedule({
        point: stageToImg(pt.x, pt.y),
        disableSnap: Boolean(event?.evt?.shiftKey),
      });
    };

    const onEnd = () => {
      const st = dragStateRef.current;
      if (!st) return;
      st.frame.flush();
      st.inProgress = false;
      detachGroupDragInput(st);
      if (st.final) {
        const patches = Object.fromEntries(
          st.final.map((position) => [position.id, { cx: position.cx, cy: position.cy }]),
        );
        plannerHistory.push('move panels');
        updatePanelsBulk(patches);
      } else {
        st.init.forEach((initial) => {
          const node = st.nodes.get(initial.id);
          node?.position({ x: initial.cx, y: initial.cy });
          node?.opacity(initial.opacity);
          st.selectionNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
          st.slopeArrowNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
        });
        if (st.handleNode && st.handleInitial) st.handleNode.position(st.handleInitial);
        st.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
      }
      st.frame.cancel();
      dragStateRef.current = null;
      clearGroupGuides();
      setGroupDragActive(false);
      const container = st.stage.container?.();
      if (container) container.style.cursor = 'default';
      handleDirectDragEnd();
    };

    const onCancel = () => cancelGroupDrag();
    const onLostPointerCapture = () => cancelGroupDrag();
    const onWindowBlur = () => cancelGroupDrag();
    const state = dragStateRef.current;
    if (state) {
      state.onLostPointerCapture = onLostPointerCapture;
      state.onWindowBlur = onWindowBlur;
    }
    captureTarget?.addEventListener('lostpointercapture', onLostPointerCapture, { once: true });
    window.addEventListener('blur', onWindowBlur, { once: true });
    stage.on('pointermove' + ns + ' mousemove' + ns + ' touchmove' + ns, onMove);
    stage.on('pointerup' + ns + ' mouseup' + ns + ' touchend' + ns, onEnd);
    stage.on('pointercancel' + ns + ' touchcancel' + ns, onCancel);
    setGroupDragActive(true);
    const container = stage.container?.();
    if (container) container.style.cursor = 'grabbing';
    handleDirectDragStart();
  }, [
    selectedPanels, stageToImg, allPanels, roofId,
    defaultAngleDeg, snapTuningImg, panels,
    updatePanelsBulk, handleDirectDragStart, handleDirectDragEnd,
    committedAdvancedDefinition, mpp, marginM, allZones, snowGuards,
    gapPx, gapXPx, gapYPx, spacingXM, spacingYM, cancelGroupDrag, detachGroupDragInput,
    clearGroupGuides, setGroupGuide, roof,
  ]);

  

const startMultiDrag = React.useCallback((e: any) => {
  if (!groupBBox || selectedPanels.length < 2) return;
  e.cancelBubble = true;      // blocca il pan dello Stage
  beginGroupDrag(e, selectedPanels, e.currentTarget); // riusa la logica già pronta
}, [groupBBox, selectedPanels, beginGroupDrag]);

const startPanelDrag = React.useCallback((panelId: string, e: any) => {
  const panel = panels.find((item) => item.id === panelId);
  if (panel && selectedSet.has(panelId) && selectedPanels.length > 1) {
    e.cancelBubble = true;
    beginGroupDrag(e, selectedPanels);
    return;
  }
  const blockKey = panel?.advanced?.blockKey;
  if (blockKey) {
    const blockPanels = panels.filter((item) => item.advanced?.blockKey === blockKey);
    if (blockPanels.length > 0) {
      e.cancelBubble = true;
      setSelectedPanels(blockPanels.map((item) => item.id));
      beginGroupDrag(e, blockPanels);
      return;
    }
  }
  startDrag(panelId, e);
}, [beginGroupDrag, panels, selectedPanels, selectedSet, setSelectedPanels, startDrag]);


  // ======================= RENDER =======================
 if (hasPlanningDraft) return null;

 return (
  <>
    {/* --- CLIPPED: pannelli + guide + banda margine --- */}
    <Group
      clipFunc={directDragActive ? undefined : clipFunc}
      listening
      onMouseDown={(e) => {
        if (
          isPrimaryPointerButton(e?.evt?.button)
          && usePlannerV2Store.getState().tool === 'select'
        ) e.cancelBubble = true;
      }}
      onTouchStart={(e) => {
        if (usePlannerV2Store.getState().tool === 'select') e.cancelBubble = true;
      }}
    >
      {panels.map((p) => {
        const sel =
          (selectedIds && selectedIds.length > 0 && selectedIds.includes(p.id)) ||
          (!selectedIds?.length && p.id === selectedPanelId);

        const rotationDeg =
          typeof p.angleDeg === 'number' ? p.angleDeg : defaultAngleDeg;
        return (
          <PanelItem
            key={p.id}
            id={p.id}
            cx={p.cx}
            cy={p.cy}
            wPx={p.wPx}
            hPx={p.hPx}
            rotationDeg={rotationDeg}
            slopeArrowAzimuthDeg={opposingArrowAzimuths.get(p.id)}
            slopeArrowLocalOffsetDeg={isPitchedRoof
              ? PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG
              : undefined}
            selected={sel}
            image={img}
            onStartDrag={startPanelDrag}
            onSelect={onSelect}
            onRoutePointerDown={routePanelPointerDown}
          />
        );
      })}

      <Guides hintURef={hintURef} hintVRef={hintVRef} />
      <Guides hintURef={groupHintURef} hintVRef={groupHintVRef} />

    </Group>

    {/* --- UNCLIPPED OVERLAY: drag handle della selezione multipla --- */}
    {groupBBox && (
      <MultiSelectionDragHandle
        x={groupBBox.x + groupBBox.w / 2}
        y={groupBBox.y + groupBBox.h + HANDLE_GAP_STAGE_PX * invScale}
        inverseScale={invScale}
        canvasRotationDeg={canvasRotationDeg}
        active={groupDragActive}
        onStart={startMultiDrag}
      />
    )}
  </>
);

}
