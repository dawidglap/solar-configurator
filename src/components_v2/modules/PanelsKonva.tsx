// src/components_v2/canvas/PanelsKonva.tsx
'use client';

import React from 'react';
import { Group } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import { usePanelDragSnap, buildGuidesCommon, snapUVToGuides, type PanelInst as HookPanel } from '../modules/panels/usePanelDragSnap';
import { PanelItem } from './panels/PanelItem';
import { Guides } from './panels/Guides';
import { isInReservedZone } from '../zones/utils';
import { legacyPointInPolygon } from '@/lib/planning-core/legacy-standard/collision';
import { createLatestFrameScheduler, type FrameScheduler } from '../canvas/performance/latestFrameScheduler';
import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import type { PanelInstance } from '@/types/planner';
import {
  resolveSurfacePlanning,
} from '@/lib/planning-core/advanced';
import {
  buildAdvancedManualCandidate,
  resolveManualAdvancedBlockDefinition,
  snapAdvancedManualCenter,
  validateExistingPanelPlacement,
} from './manualPlacement';
import MultiSelectionDragHandle from './panels/MultiSelectionDragHandle';
import { resolveDirectLayoutTargets } from './panels/directLayoutGeometry';

const SNAP_STAGE_PX = 10;           // magnetic activation radius (screen px)
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
  const rawUpdatePanel = usePlannerV2Store((s) => s.updatePanel);
  const updatePanelsBulk = usePlannerV2Store((s) => s.updatePanelsBulk);
  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);
  const allZones = usePlannerV2Store((s) => s.zones);
  const snowGuards = usePlannerV2Store((s) => s.snowGuards);
  const panels = React.useMemo(
    () => allPanels.filter((p) => p.roofId === roofId),
    [allPanels, roofId]
  );


  // multiselezione
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds || []);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  // scale corrente
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);
  const invScale = 1 / (stageScale || 1);
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX * invScale, [invScale]);

  // margine progetto → px immagine
  const marginM = usePlannerV2Store((s) => {
    const roof = s.layers.find((item) => item.id === roofId);
    return roof ? resolveRoofEdgeMarginM(roof, s.modules.marginM) : s.modules.marginM;
  }) ?? 0;
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage) ?? 1;
  const edgeMarginPx = React.useMemo(() => (mpp ? marginM / mpp : 0), [marginM, mpp]);
  const spacingM = usePlannerV2Store((s) => s.modules.spacingM) ?? 0;
  const spacingXM = usePlannerV2Store((s) => s.modules.spacingXM) ?? spacingM;
  const spacingYM = usePlannerV2Store((s) => s.modules.spacingYM) ?? spacingM;
  const gapPx = React.useMemo(() => (mpp ? spacingM / mpp : 0), [spacingM, mpp]);
  const gapXPx = React.useMemo(() => (mpp ? spacingXM / mpp : 0), [spacingXM, mpp]);
  const gapYPx = React.useMemo(() => (mpp ? spacingYM / mpp : 0), [spacingYM, mpp]);
  const reservedPolygons = React.useMemo(
    () => allZones
      .filter((zone) => zone.roofId === roofId && zone.type === 'riservata')
      .map((zone) => zone.points),
    [allZones, roofId],
  );
  const isReservedCenter = React.useCallback(
    (cx: number, cy: number) => reservedPolygons.some((polygon) =>
      legacyPointInPolygon({ x: cx, y: cy }, polygon),
    ),
    [reservedPolygons],
  );

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
  // assi locali falda
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta), y: Math.sin(theta) }; // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta) }; // v axis
  const project = React.useCallback(
    (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y }),
    [ex.x, ex.y, ey.x, ey.y],
  );
  const fromUV = React.useCallback(
    (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y }),
    [ex.x, ex.y, ey.x, ey.y],
  );

  // bounds UV falda
  const uvBounds = React.useMemo(() => {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of roofPolygon) {
      const uv = project(p);
      if (uv.u < minU) minU = uv.u;
      if (uv.u > maxU) maxU = uv.u;
      if (uv.v < minV) minV = uv.v;
      if (uv.v > maxV) maxV = uv.v;
    }
    return { minU, maxU, minV, maxV };
  }, [roofPolygon, project]);

  const normalizePanelCandidate = React.useCallback(
    (id: string, proposedCx: number, proposedCy: number): Pt | null => {
      const panel = allPanels.find((p) => p.id === id);
      if (!panel) return null;

      let nextCx = proposedCx;
      let nextCy = proposedCy;

      if (typeof nextCx === 'number' && typeof nextCy === 'number') {
        const uv = project({ x: nextCx, y: nextCy });

        const hw = panel.wPx / 2;
        const hh = panel.hPx / 2;
        const m = edgeMarginPx;

        // limiti in UV considerando:
        // - bordo falda
        // - randabstand (m)
        // - metà dimensione pannello
        let u = uv.u;
        let v = uv.v;

        const minU = uvBounds.minU + m + hw;
        const maxU = uvBounds.maxU - m - hw;
        const minV = uvBounds.minV + m + hh;
        const maxV = uvBounds.maxV - m - hh;

        if (u < minU) u = minU;
        if (u > maxU) u = maxU;
        if (v < minV) v = minV;
        if (v > maxV) v = maxV;

        const corrected = fromUV(u, v);
        nextCx = corrected.x;
        nextCy = corrected.y;

        if (isReservedCenter(nextCx, nextCy)) return null;
        if (roof && !validateExistingPanelPlacement({
          panel,
          centerPx: { x: nextCx, y: nextCy },
          roof,
          marginM,
          mppImage: mpp,
          zones: allZones,
          snowGuards,
          panels: allPanels,
        }).valid) return null;
      }

      return { x: nextCx, y: nextCy };
    },
    [allPanels, allZones, edgeMarginPx, fromUV, isReservedCenter, marginM, mpp, project, roof, snowGuards, uvBounds]
  );

  const updatePanel = React.useCallback(
    (id: string, patch: Partial<PanelInst>) => {
      const panel = allPanels.find((p) => p.id === id);
      if (!panel) {
        rawUpdatePanel(id, patch as any);
        return;
      }

      const normalized = normalizePanelCandidate(
        id,
        patch.cx ?? panel.cx,
        patch.cy ?? panel.cy,
      );
      if (!normalized) return;

      rawUpdatePanel(id, { ...patch, cx: normalized.x, cy: normalized.y } as any);
    },
    [allPanels, rawUpdatePanel, normalizePanelCandidate]
  );



  // drag singolo (immutato)
  const { startDrag, hintURef, hintVRef } = usePanelDragSnap({
    defaultAngleDeg,
    project,
    fromUV,
    uvBounds,
    allPanels,
    roofId,
    stageToImg,
    updatePanel,
    onSelect,
    onDragStart,
    onDragEnd,
    snapPxImg,
    edgeMarginPx,
    gapPx,
    gapXPx,
    gapYPx,
    reservedGuard: (cx, cy) => !isReservedCenter(cx, cy),
    normalizeCandidate: normalizePanelCandidate,
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

  // helpers
  const isInsideBounds = React.useCallback(
    (p: PanelInst, cx: number, cy: number) => {
      const uv = project({ x: cx, y: cy });
      const hw = p.wPx / 2;
      const hh = p.hPx / 2;
      const m = edgeMarginPx;

      const minU = uvBounds.minU + m + hw;
      const maxU = uvBounds.maxU - m - hw;
      const minV = uvBounds.minV + m + hh;
      const maxV = uvBounds.maxV - m - hh;

      if (uv.u < minU || uv.u > maxU) return false;
      if (uv.v < minV || uv.v > maxV) return false;
      if (isInReservedZone({ x: cx, y: cy }, roofId)) return false;
      return true;
    },
    [edgeMarginPx, project, uvBounds, roofId]
  );


  const anyOverlapWithNonSelected = React.useCallback((cand: { id: string; cx: number; cy: number }[]) => {
    if (!roof) return true;
    const movingIds = new Set(cand.map((candidate) => candidate.id));
    const movingPanels = cand.map((candidate) => panels.find((panel) => panel.id === candidate.id))
      .filter((panel): panel is PanelInst => Boolean(panel));
    const advancedBlockKey = movingPanels[0]?.advanced?.blockKey;
    const isOneCompleteAdvancedBlock = Boolean(
      advancedBlockKey &&
      movingPanels.length > 0 &&
      movingPanels.every((panel) => panel.advanced?.blockKey === advancedBlockKey) &&
      panels.filter((panel) => panel.advanced?.blockKey === advancedBlockKey).length === movingPanels.length,
    );
    if (isOneCompleteAdvancedBlock) {
      const persisted = resolveSurfacePlanning(roof.surfacePlanning);
      if (persisted.status === 'supported-advanced') {
        const centerPx = {
          x: cand.reduce((sum, candidate) => sum + candidate.cx, 0) / cand.length,
          y: cand.reduce((sum, candidate) => sum + candidate.cy, 0) / cand.length,
        };
        const blockCandidate = buildAdvancedManualCandidate({
          centerPx,
          roof,
          config: persisted.config,
          mppImage: mpp,
          zones: allZones,
          snowGuards,
          panels: allPanels.filter((panel) => !movingIds.has(panel.id)),
        });
        if (!blockCandidate.valid) return true;
      }
    }
    // controlla overlap rettangoli paralleli su U/V con gap
    const nonSel = panels.filter(p => !movingIds.has(p.id));
    for (const c of cand) {
      const me = panels.find(p => p.id === c.id)!;
      if (!validateExistingPanelPlacement({
        panel: me,
        centerPx: { x: c.cx, y: c.cy },
        roof,
        marginM,
        mppImage: mpp,
        zones: allZones,
        snowGuards,
        panels: allPanels,
        excludePanelIds: movingIds,
      }).valid) return true;
      const meUV = project({ x: c.cx, y: c.cy });
      const meHW = me.wPx / 2, meHH = me.hPx / 2;

      for (const t of nonSel) {
        const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
        // considera snap solo per pannelli paralleli (come nel singolo)
        if (Math.min(angleDiffDeg(tAngle, defaultAngleDeg), Math.abs(angleDiffDeg(tAngle, defaultAngleDeg) - 180)) > 5) continue;

        const tUV = project({ x: t.cx, y: t.cy });
        const thw = t.wPx / 2, thh = t.hPx / 2;

        const minU = meHW + thw + gapXPx;
        const minV = meHH + thh + gapYPx;

        const du = Math.abs(meUV.u - tUV.u);
        const dv = Math.abs(meUV.v - tUV.v);
        if (du < minU && dv < minV) return true; // overlap
      }
    }
    return false;
  }, [allPanels, allZones, defaultAngleDeg, gapXPx, gapYPx, marginM, mpp, panels, project, roof, snowGuards]);

  // hint lines per il drag di gruppo
  const [groupHintU, setGroupHintU] = React.useState<number[] | null>(null);
  const [groupHintV, setGroupHintV] = React.useState<number[] | null>(null);
  const [groupDragActive, setGroupDragActive] = React.useState(false);

  // stato drag di gruppo
  const dragStateRef = React.useRef<{
    stage: any;
    startImg: Pt;
    inProgress: boolean;
    init: { id: string; cx: number; cy: number; u: number; v: number }[];
    anchorId: string;
    anchorInitUV: { u: number; v: number; hw: number; hh: number };
    guides: { uCenters: number[]; uEdges: number[]; vCenters: number[]; vEdges: number[] };
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
    } | null;
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
      state.nodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
      state.selectionNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
      state.slopeArrowNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
    });
    if (state.handleNode && state.handleInitial) state.handleNode.position(state.handleInitial);
    state.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
    dragStateRef.current = null;
    setGroupHintU(null);
    setGroupHintV(null);
    setGroupDragActive(false);
    const container = state.stage.container?.();
    if (container) container.style.cursor = 'default';
    onDragEnd?.();
    return true;
  }, [detachGroupDragInput, onDragEnd]);

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
    if (movingPanels.length < 2 || !stageToImg) return;

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

    // ancora = primo selezionato
    const anchor = movingPanels[0];
    const anchorUV = project({ x: anchor.cx, y: anchor.cy });
    const anchorHW = anchor.wPx / 2;
    const anchorHH = anchor.hPx / 2;

    // guide: escludi tutto il gruppo
    const guides = buildGuidesCommon({
      allPanels,
      roofId,
      defaultAngleDeg,
      project,
      uvBounds,
      edgeMarginPx,
      excludeIds: new Set(movingPanels.map(p => p.id)),
    });

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
    const movingBlockKey = movingPanels[0]?.advanced?.blockKey;
    const isCompleteAdvancedBlock = Boolean(
      movingBlockKey &&
      committedAdvancedDefinition &&
      movingPanels.every((panel) => panel.advanced?.blockKey === movingBlockKey) &&
      panels.filter((panel) => panel.advanced?.blockKey === movingBlockKey).length === movingPanels.length,
    );
    const advancedSnap = isCompleteAdvancedBlock && committedAdvancedDefinition
      ? {
          definition: committedAdvancedDefinition,
          initialCenter: {
            x: movingPanels.reduce((sum, panel) => sum + panel.cx, 0) / movingPanels.length,
            y: movingPanels.reduce((sum, panel) => sum + panel.cy, 0) / movingPanels.length,
          },
          otherPanels: allPanels.filter((panel) => !movingIds.has(panel.id)),
        }
      : null;

    const onFrame = ({ point: curImg, disableSnap }: { point: Pt; disableSnap: boolean }) => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const dImgX = curImg.x - st.startImg.x;
      const dImgY = curImg.y - st.startImg.y;

      const anchorInit = st.init.find(i => i.id === st.anchorId)!;
      let anchorCandUV = project({
        x: anchorInit.cx + dImgX,
        y: anchorInit.cy + dImgY,
      });
      if (st.advancedSnap) {
        const rawCenter = {
          x: st.advancedSnap.initialCenter.x + dImgX,
          y: st.advancedSnap.initialCenter.y + dImgY,
        };
        const snappedCenter = snapAdvancedManualCenter({
          pointerPx: rawCenter,
          roofId,
          panels: st.advancedSnap.otherPanels,
          definition: st.advancedSnap.definition,
          mppImage: mpp,
          activationThresholdPx: snapPxImg,
          disableSnap,
        });
        anchorCandUV = project({
          x: anchorInit.cx + snappedCenter.x - st.advancedSnap.initialCenter.x,
          y: anchorInit.cy + snappedCenter.y - st.advancedSnap.initialCenter.y,
        });
      }

      const snapped = disableSnap || st.advancedSnap
        ? { bestU: anchorCandUV.u, bestV: anchorCandUV.v, hintU: null, hintV: null }
        : snapUVToGuides({
            curU: anchorCandUV.u,
            curV: anchorCandUV.v,
            hw: st.anchorInitUV.hw,
            hh: st.anchorInitUV.hh,
            guides: st.guides,
            snapPxImg,
            fromUV,
            uvBounds,
          });

      setGroupHintU(snapped.hintU);
      setGroupHintV(snapped.hintV);

      const dU = snapped.bestU - st.anchorInitUV.u;
      const dV = snapped.bestV - st.anchorInitUV.v;
      const proposed = st.init.map(i => {
        const pNew = fromUV(i.u + dU, i.v + dV);
        return { id: i.id, cx: pNew.x, cy: pNew.y };
      });

      for (const q of proposed) {
        const pp = panels.find(x => x.id === q.id)!;
        if (!isInsideBounds(pp, q.cx, q.cy)) return;
      }
      if (anyOverlapWithNonSelected(proposed)) return;

      st.final = proposed;
      proposed.forEach((position) => {
        st.nodes.get(position.id)?.position({ x: position.cx, y: position.cy });
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
        const uv = project({ x: p.cx, y: p.cy });
        return { id: p.id, cx: p.cx, cy: p.cy, u: uv.u, v: uv.v };
      }),
      anchorId: anchor.id,
      anchorInitUV: { u: anchorUV.u, v: anchorUV.v, hw: anchorHW, hh: anchorHH },
      guides,
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
      frame,
    };

    const ns = '.groupDrag';
    setGroupHintU(null); setGroupHintV(null);

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
        updatePanelsBulk(patches);
      }
      st.frame.cancel();
      dragStateRef.current = null;
      setGroupHintU(null); setGroupHintV(null);
      setGroupDragActive(false);
      const container = st.stage.container?.();
      if (container) container.style.cursor = 'default';
      onDragEnd?.();
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
    onDragStart?.();
  }, [
    selectedPanels, stageToImg, allPanels, roofId,
    defaultAngleDeg, project, uvBounds, edgeMarginPx, snapPxImg,
    fromUV, panels, isInsideBounds, anyOverlapWithNonSelected,
    updatePanelsBulk, onDragStart, onDragEnd,
    committedAdvancedDefinition, mpp, cancelGroupDrag, detachGroupDragInput,
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
    if (blockPanels.length > 1) {
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
      clipFunc={clipFunc}
      listening
      onMouseDown={(e) => { e.cancelBubble = true; }}
      onTouchStart={(e) => { e.cancelBubble = true; }}
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
            selected={sel}
            image={img}
            onStartDrag={startPanelDrag}
            onSelect={onSelect}
          />
        );
      })}

      {groupHintU || groupHintV ? (
        <Guides hintU={groupHintU} hintV={groupHintV} />
      ) : (
        <Guides hintURef={hintURef} hintVRef={hintVRef} />
      )}

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
