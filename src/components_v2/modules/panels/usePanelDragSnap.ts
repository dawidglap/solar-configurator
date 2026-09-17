// src/components_v2/modules/panels/usePanelDragSnap.ts
'use client';

import React from 'react';
import type Konva from 'konva';
import type { Pt } from './math';
import { angleDiffDeg } from './math';
import { createLatestFrameScheduler, type FrameScheduler } from '../../canvas/performance/latestFrameScheduler';

export type UV = { u: number; v: number };
export type UVBounds = { minU: number; maxU: number; minV: number; maxV: number };
export type ProjectFn = (pt: Pt) => UV;
export type FromUVFn = (u: number, v: number) => Pt;

export type PanelInst = {
  id: string;
  roofId: string;
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  angleDeg?: number;
};

type Args = {
  defaultAngleDeg: number;
  allPanels: PanelInst[];
  roofId: string;
  stageToImg?: (x: number, y: number) => Pt;
  commitPanel: (id: string, patch: Partial<PanelInst>) => void;
  prepareValidateCandidate: (id: string) => ((cx: number, cy: number) => boolean) | undefined;
  onSelect?: (id?: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  snapTuningImg: PanelSnapTuning;
  gapPx?: number;
  gapXPx?: number;
  gapYPx?: number;
};

const PARALLEL_TOLERANCE_DEG = 0.25;
export type PanelSnapTuning = {
  adjacencyActivationPx: number;
  adjacencyReleasePx: number;
  alignmentActivationPx: number;
  alignmentReleasePx: number;
  adjacencyPriorityBonusPx: number;
};

/** Deliberately screen-space values: zoom must not change the perceived magnet. */
export const PANEL_SNAP_TUNING_SCREEN_PX: Readonly<PanelSnapTuning> = Object.freeze({
  adjacencyActivationPx: 18,
  adjacencyReleasePx: 26,
  alignmentActivationPx: 9,
  alignmentReleasePx: 15,
  adjacencyPriorityBonusPx: 8,
});

export function panelSnapTuningForScale(stageScale: number): PanelSnapTuning {
  const inverseScale = 1 / Math.max(Math.abs(stageScale), 1e-6);
  return {
    adjacencyActivationPx: PANEL_SNAP_TUNING_SCREEN_PX.adjacencyActivationPx * inverseScale,
    adjacencyReleasePx: PANEL_SNAP_TUNING_SCREEN_PX.adjacencyReleasePx * inverseScale,
    alignmentActivationPx: PANEL_SNAP_TUNING_SCREEN_PX.alignmentActivationPx * inverseScale,
    alignmentReleasePx: PANEL_SNAP_TUNING_SCREEN_PX.alignmentReleasePx * inverseScale,
    adjacencyPriorityBonusPx: PANEL_SNAP_TUNING_SCREEN_PX.adjacencyPriorityBonusPx * inverseScale,
  };
}

export function panelAnglesAreCompatible(angleA: number, angleB: number): boolean {
  const diff = angleDiffDeg(angleA, angleB);
  return Math.min(diff, Math.abs(diff - 180)) <= PARALLEL_TOLERANCE_DEG;
}

export function createPanelAxis(angleDeg: number): {
  project: ProjectFn;
  fromUV: FromUVFn;
} {
  const radians = angleDeg * Math.PI / 180;
  const ex = { x: Math.cos(radians), y: Math.sin(radians) };
  const ey = { x: -Math.sin(radians), y: Math.cos(radians) };
  return {
    project: (point) => ({
      u: point.x * ex.x + point.y * ex.y,
      v: point.x * ey.x + point.y * ey.y,
    }),
    fromUV: (u, v) => ({
      x: u * ex.x + v * ey.x,
      y: u * ex.y + v * ey.y,
    }),
  };
}

export type StaticPanelUV = {
  id: string;
  u: number;
  v: number;
  hw: number;
  hh: number;
};

export function buildPanelDragStaticGeometry(input: {
  allPanels: PanelInst[];
  roofId: string;
  excludeId?: string;
  excludeIds?: ReadonlySet<string>;
  defaultAngleDeg: number;
  axisAngleDeg?: number;
  project: ProjectFn;
}): StaticPanelUV[] {
  const axisAngleDeg = input.axisAngleDeg ?? input.defaultAngleDeg;
  return input.allPanels.flatMap((panel) => {
    if (
      panel.roofId !== input.roofId ||
      panel.id === input.excludeId ||
      input.excludeIds?.has(panel.id)
    ) return [];
    const angle = typeof panel.angleDeg === 'number' ? panel.angleDeg : input.defaultAngleDeg;
    if (!panelAnglesAreCompatible(angle, axisAngleDeg)) return [];
    const uv = input.project({ x: panel.cx, y: panel.cy });
    return [{ id: panel.id, u: uv.u, v: uv.v, hw: panel.wPx / 2, hh: panel.hPx / 2 }];
  });
}

export type PanelDragSpatialIndex = {
  query: (u: number, v: number, radius: number) => StaticPanelUV[];
  size: number;
};

export function createPanelDragSpatialIndex(
  panels: readonly StaticPanelUV[],
  cellSize = 96,
): PanelDragSpatialIndex {
  const safeCellSize = Math.max(16, cellSize);
  const buckets = new Map<string, StaticPanelUV[]>();
  const key = (column: number, row: number) => `${column}:${row}`;
  for (const panel of panels) {
    const minColumn = Math.floor((panel.u - panel.hw) / safeCellSize);
    const maxColumn = Math.floor((panel.u + panel.hw) / safeCellSize);
    const minRow = Math.floor((panel.v - panel.hh) / safeCellSize);
    const maxRow = Math.floor((panel.v + panel.hh) / safeCellSize);
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        const bucketKey = key(column, row);
        buckets.set(bucketKey, [...(buckets.get(bucketKey) ?? []), panel]);
      }
    }
  }
  return {
    size: panels.length,
    query(u, v, radius) {
      const minColumn = Math.floor((u - radius) / safeCellSize);
      const maxColumn = Math.floor((u + radius) / safeCellSize);
      const minRow = Math.floor((v - radius) / safeCellSize);
      const maxRow = Math.floor((v + radius) / safeCellSize);
      const result = new Map<string, StaticPanelUV>();
      for (let column = minColumn; column <= maxColumn; column += 1) {
        for (let row = minRow; row <= maxRow; row += 1) {
          for (const panel of buckets.get(key(column, row)) ?? []) result.set(panel.id, panel);
        }
      }
      return [...result.values()];
    },
  };
}

type SnapKind = 'adjacency' | 'alignment-u' | 'alignment-v';
type SnapCandidate = {
  key: string;
  position: UV;
  distance: number;
  kind: SnapKind;
  hintU: boolean;
  hintV: boolean;
};

function generateSnapCandidates(input: {
  free: UV;
  hw: number;
  hh: number;
  gapXPx: number;
  gapYPx: number;
  panels: readonly StaticPanelUV[];
}): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  for (const panel of input.panels) {
    const horizontalOffset = input.hw + panel.hw + input.gapXPx;
    const verticalOffset = input.hh + panel.hh + input.gapYPx;
    const adjacency = [
      ['left', { u: panel.u - horizontalOffset, v: panel.v }],
      ['right', { u: panel.u + horizontalOffset, v: panel.v }],
      ['top', { u: panel.u, v: panel.v - verticalOffset }],
      ['bottom', { u: panel.u, v: panel.v + verticalOffset }],
    ] as const;
    adjacency.forEach(([side, position]) => candidates.push({
      key: `adjacency:${panel.id}:${side}`,
      position,
      distance: Math.hypot(input.free.u - position.u, input.free.v - position.v),
      kind: 'adjacency',
      hintU: side === 'left' || side === 'right',
      hintV: side === 'top' || side === 'bottom',
    }));

    const uTargets = [panel.u, panel.u - panel.hw + input.hw, panel.u + panel.hw - input.hw];
    uTargets.forEach((u, index) => candidates.push({
      key: `alignment-u:${panel.id}:${index}`,
      position: { u, v: input.free.v },
      distance: Math.abs(input.free.u - u),
      kind: 'alignment-u',
      hintU: true,
      hintV: false,
    }));
    const vTargets = [panel.v, panel.v - panel.hh + input.hh, panel.v + panel.hh - input.hh];
    vTargets.forEach((v, index) => candidates.push({
      key: `alignment-v:${panel.id}:${index}`,
      position: { u: input.free.u, v },
      distance: Math.abs(input.free.v - v),
      kind: 'alignment-v',
      hintU: false,
      hintV: true,
    }));
  }
  return candidates;
}

export type PanelDragFrameResolution = {
  position: UV;
  valid: boolean;
  snapped: boolean;
  snapKey: string | null;
  hintU: boolean;
  hintV: boolean;
};

/**
 * Pointer position remains authoritative. Magnetic positions are complete 2-D
 * proposals, validated before use. An invalid proposal can never block a valid
 * free pointer position.
 */
export function resolvePanelDragFrameUV(input: {
  free: UV;
  hw: number;
  hh: number;
  gapXPx: number;
  gapYPx: number;
  activationThresholdPx: number;
  releaseThresholdPx?: number;
  snapTuning?: PanelSnapTuning;
  disableSnap?: boolean;
  activeSnapKey?: string | null;
  panels: readonly StaticPanelUV[];
  validate: (position: UV) => boolean;
}): PanelDragFrameResolution {
  const freeValid = input.validate(input.free);
  if (input.disableSnap) {
    return { position: input.free, valid: freeValid, snapped: false, snapKey: null, hintU: false, hintV: false };
  }
  const legacyActivation = Math.max(0, input.activationThresholdPx);
  const legacyRelease = Math.max(legacyActivation, input.releaseThresholdPx ?? legacyActivation * 1.5);
  const tuning: PanelSnapTuning = input.snapTuning ?? {
    adjacencyActivationPx: legacyActivation,
    adjacencyReleasePx: legacyRelease,
    alignmentActivationPx: legacyActivation,
    alignmentReleasePx: legacyRelease,
    adjacencyPriorityBonusPx: legacyActivation * 0.25,
  };
  const thresholdFor = (candidate: SnapCandidate) => {
    const active = candidate.key === input.activeSnapKey;
    if (candidate.kind === 'adjacency') {
      return active ? tuning.adjacencyReleasePx : tuning.adjacencyActivationPx;
    }
    return active ? tuning.alignmentReleasePx : tuning.alignmentActivationPx;
  };
  const candidates = generateSnapCandidates(input).filter((candidate) => {
    return candidate.distance <= thresholdFor(candidate) && input.validate(candidate.position);
  });
  const score = (candidate: SnapCandidate) => candidate.distance - (
    candidate.kind === 'adjacency' ? tuning.adjacencyPriorityBonusPx : 0
  );
  candidates.sort((first, second) => {
    return score(first) - score(second) || first.key.localeCompare(second.key);
  });
  const active = input.activeSnapKey
    ? candidates.find((candidate) => candidate.key === input.activeSnapKey)
    : undefined;
  const best = candidates[0];
  // Hysteresis keeps an active target stable. Exact adjacency may however
  // pre-empt a generic guide because it is the user's stronger intent.
  const chosen = active && !(active.kind !== 'adjacency' && best?.kind === 'adjacency')
    ? active
    : best;
  if (!chosen) {
    return { position: input.free, valid: freeValid, snapped: false, snapKey: null, hintU: false, hintV: false };
  }
  return {
    position: chosen.position,
    valid: true,
    snapped: true,
    snapKey: chosen.key,
    hintU: chosen.hintU,
    hintV: chosen.hintV,
  };
}

/** Compatibility helper used by manual placement tests. */
export function resolveMagneticNeighbourSnapUV(input: {
  u: number;
  v: number;
  hw: number;
  hh: number;
  gapXPx: number;
  gapYPx: number;
  activationThresholdPx: number;
  panels: readonly StaticPanelUV[];
}): UV | null {
  const candidates = generateSnapCandidates({
    free: { u: input.u, v: input.v },
    hw: input.hw,
    hh: input.hh,
    gapXPx: input.gapXPx,
    gapYPx: input.gapYPx,
    panels: input.panels,
  }).filter((candidate) => candidate.kind === 'adjacency' && candidate.distance <= input.activationThresholdPx);
  candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return candidates[0]?.position ?? null;
}

export function hasPanelOverlapCached(input: {
  u: number;
  v: number;
  hw: number;
  hh: number;
  gapPx: number;
  gapXPx?: number;
  gapYPx?: number;
  panels: readonly StaticPanelUV[];
}): boolean {
  const epsilon = 1e-6;
  return input.panels.some((panel) => {
    const minU = input.hw + panel.hw + (input.gapXPx ?? input.gapPx);
    const minV = input.hh + panel.hh + (input.gapYPx ?? input.gapPx);
    return Math.abs(input.u - panel.u) < minU - epsilon &&
      Math.abs(input.v - panel.v) < minV - epsilon;
  });
}

type NodeVisualSnapshot = {
  opacity: number;
  stroke?: string;
  strokeWidth?: number;
};

function readNodeVisual(node: Konva.Node | null): NodeVisualSnapshot | null {
  if (!node) return null;
  const shape = node as Konva.Node & {
    stroke?: () => string | undefined;
    strokeWidth?: () => number;
  };
  return {
    opacity: node.opacity(),
    stroke: typeof shape.stroke === 'function' ? shape.stroke() : undefined,
    strokeWidth: typeof shape.strokeWidth === 'function' ? shape.strokeWidth() : undefined,
  };
}

function setNodeInvalidVisual(
  node: Konva.Node | null,
  invalid: boolean,
  original?: NodeVisualSnapshot | null,
): void {
  if (!node) return;
  node.opacity(invalid ? 0.58 : (original?.opacity ?? 1));
  const shape = node as Konva.Node & {
    stroke?: (value?: string) => string | Konva.Node;
    strokeWidth?: (value?: number) => number | Konva.Node;
  };
  if (typeof shape.stroke === 'function') shape.stroke(invalid ? '#FF6B5F' : original?.stroke);
  if (typeof shape.strokeWidth === 'function') shape.strokeWidth(invalid ? 1.5 : (original?.strokeWidth ?? 0));
}

export function usePanelDragSnap({
  defaultAngleDeg,
  allPanels,
  roofId,
  stageToImg,
  commitPanel,
  prepareValidateCandidate,
  onSelect,
  onDragStart,
  onDragEnd,
  snapTuningImg,
  gapPx = 0,
  gapXPx,
  gapYPx,
}: Args) {
  const stageRef = React.useRef<any>(null);
  const draggingIdRef = React.useRef<string | null>(null);
  const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const dragSizeHalfRef = React.useRef<{ hw: number; hh: number } | null>(null);
  const draggedNodeRef = React.useRef<Konva.Node | null>(null);
  const draggedNodeVisualRef = React.useRef<NodeVisualSnapshot | null>(null);
  const draggedSelectionNodeRef = React.useRef<Konva.Node | null>(null);
  const draggedSlopeArrowNodeRef = React.useRef<Konva.Node | null>(null);
  const dragStartPanelRef = React.useRef<PanelInst | null>(null);
  const finalPositionRef = React.useRef<Pt | null>(null);
  const validateCandidateRef = React.useRef<((cx: number, cy: number) => boolean) | null>(null);
  const axisRef = React.useRef<ReturnType<typeof createPanelAxis> | null>(null);
  const spatialIndexRef = React.useRef<PanelDragSpatialIndex | null>(null);
  const activeSnapKeyRef = React.useRef<string | null>(null);
  const frameRef = React.useRef<FrameScheduler<{ point: Pt; disableSnap: boolean }> | null>(null);
  const hintURef = React.useRef<Konva.Line | null>(null);
  const hintVRef = React.useRef<Konva.Line | null>(null);

  const setGuide = React.useCallback((ref: React.MutableRefObject<Konva.Line | null>, points: number[] | null) => {
    ref.current?.points(points ?? []);
    ref.current?.visible(Boolean(points));
  }, []);
  const clearHints = React.useCallback(() => {
    setGuide(hintURef, null);
    setGuide(hintVRef, null);
  }, [setGuide]);

  const restoreStartGeometry = React.useCallback(() => {
    const initial = dragStartPanelRef.current;
    if (!initial) return;
    draggedNodeRef.current?.position({ x: initial.cx, y: initial.cy });
    draggedSelectionNodeRef.current?.position({ x: initial.cx, y: initial.cy });
    draggedSlopeArrowNodeRef.current?.position({ x: initial.cx, y: initial.cy });
    setNodeInvalidVisual(draggedNodeRef.current, false, draggedNodeVisualRef.current);
    draggedNodeRef.current?.getLayer()?.batchDraw();
  }, []);

  const endDrag = React.useCallback((commit = true) => {
    if (!draggingIdRef.current) return;
    frameRef.current?.flush();
    stageRef.current?.off('.paneldrag');
    if (commit && draggingIdRef.current && finalPositionRef.current) {
      setNodeInvalidVisual(draggedNodeRef.current, false, draggedNodeVisualRef.current);
      commitPanel(draggingIdRef.current, {
        cx: finalPositionRef.current.x,
        cy: finalPositionRef.current.y,
      });
    } else {
      restoreStartGeometry();
    }
    frameRef.current?.cancel();
    draggingIdRef.current = null;
    startOffsetRef.current = null;
    dragSizeHalfRef.current = null;
    draggedNodeRef.current = null;
    draggedNodeVisualRef.current = null;
    draggedSelectionNodeRef.current = null;
    draggedSlopeArrowNodeRef.current = null;
    dragStartPanelRef.current = null;
    finalPositionRef.current = null;
    validateCandidateRef.current = null;
    axisRef.current = null;
    spatialIndexRef.current = null;
    activeSnapKeyRef.current = null;
    clearHints();
    onDragEnd?.();
  }, [clearHints, commitPanel, onDragEnd, restoreStartGeometry]);

  const startDrag = React.useCallback((panelId: string, event: any) => {
    if (!stageToImg) return;
    event.cancelBubble = true;
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    const panel = allPanels.find((candidate) => candidate.id === panelId);
    if (!stage || !pointer || !panel) return;

    onSelect?.(panelId);
    onDragStart?.();
    stageRef.current = stage;
    const pointerImg = stageToImg(pointer.x, pointer.y);
    const angleDeg = typeof panel.angleDeg === 'number' ? panel.angleDeg : defaultAngleDeg;
    const axis = createPanelAxis(angleDeg);
    const staticPanels = buildPanelDragStaticGeometry({
      allPanels,
      roofId,
      excludeId: panelId,
      defaultAngleDeg,
      axisAngleDeg: angleDeg,
      project: axis.project,
    });
    const largestPanelExtent = staticPanels.reduce(
      (largest, candidate) => Math.max(largest, candidate.hw * 2, candidate.hh * 2),
      Math.max(panel.wPx, panel.hPx),
    );
    spatialIndexRef.current = createPanelDragSpatialIndex(
      staticPanels,
      Math.max(32, largestPanelExtent + snapTuningImg.adjacencyReleasePx * 2),
    );
    axisRef.current = axis;
    startOffsetRef.current = { dx: panel.cx - pointerImg.x, dy: panel.cy - pointerImg.y };
    draggingIdRef.current = panelId;
    dragSizeHalfRef.current = { hw: panel.wPx / 2, hh: panel.hPx / 2 };
    draggedNodeRef.current = event.target;
    draggedNodeVisualRef.current = readNodeVisual(event.target);
    draggedSelectionNodeRef.current = stage.findOne(`#panel-selection-${panelId}`) ?? null;
    draggedSlopeArrowNodeRef.current = stage.findOne(`#panel-slope-arrow-${panelId}`) ?? null;
    dragStartPanelRef.current = { ...panel };
    finalPositionRef.current = { x: panel.cx, y: panel.cy };
    validateCandidateRef.current = prepareValidateCandidate(panelId) ?? null;
    activeSnapKeyRef.current = null;
    clearHints();

    const applyPointerFrame = ({ point, disableSnap }: { point: Pt; disableSnap: boolean }) => {
      const offset = startOffsetRef.current;
      const half = dragSizeHalfRef.current;
      const currentAxis = axisRef.current;
      const validator = validateCandidateRef.current;
      if (!offset || !half || !currentAxis || !validator) return;
      const freeWorld = { x: point.x + offset.dx, y: point.y + offset.dy };
      const free = currentAxis.project(freeWorld);
      const searchRadius = Math.max(half.hw, half.hh) * 2 + snapTuningImg.adjacencyReleasePx;
      const nearby = spatialIndexRef.current?.query(free.u, free.v, searchRadius) ?? [];
      const resolution = resolvePanelDragFrameUV({
        free,
        hw: half.hw,
        hh: half.hh,
        gapXPx: gapXPx ?? gapPx,
        gapYPx: gapYPx ?? gapPx,
        activationThresholdPx: snapTuningImg.adjacencyActivationPx,
        releaseThresholdPx: snapTuningImg.adjacencyReleasePx,
        snapTuning: snapTuningImg,
        disableSnap,
        activeSnapKey: activeSnapKeyRef.current,
        panels: nearby,
        validate: (position) => {
          const world = currentAxis.fromUV(position.u, position.v);
          return validator(world.x, world.y);
        },
      });
      activeSnapKeyRef.current = resolution.snapKey;
      const visual = currentAxis.fromUV(resolution.position.u, resolution.position.v);
      finalPositionRef.current = resolution.valid ? visual : null;
      setNodeInvalidVisual(
        draggedNodeRef.current,
        !resolution.valid,
        draggedNodeVisualRef.current,
      );
      draggedNodeRef.current?.position(visual);
      draggedSelectionNodeRef.current?.position(visual);
      draggedSlopeArrowNodeRef.current?.position(visual);

      if (resolution.snapped && resolution.hintU) {
        const extent = 10000;
        const a = currentAxis.fromUV(resolution.position.u, resolution.position.v - extent);
        const b = currentAxis.fromUV(resolution.position.u, resolution.position.v + extent);
        setGuide(hintURef, [a.x, a.y, b.x, b.y]);
      } else setGuide(hintURef, null);
      if (resolution.snapped && resolution.hintV) {
        const extent = 10000;
        const a = currentAxis.fromUV(resolution.position.u - extent, resolution.position.v);
        const b = currentAxis.fromUV(resolution.position.u + extent, resolution.position.v);
        setGuide(hintVRef, [a.x, a.y, b.x, b.y]);
      } else setGuide(hintVRef, null);
      draggedNodeRef.current?.getLayer()?.batchDraw();
    };

    frameRef.current = createLatestFrameScheduler(applyPointerFrame);
    const namespace = '.paneldrag';
    stage.off(namespace);
    stage.on(`pointermove${namespace} mousemove${namespace} touchmove${namespace}`, (moveEvent: any) => {
      const nextPointer = stage.getPointerPosition();
      if (!nextPointer) return;
      frameRef.current?.schedule({
        point: stageToImg(nextPointer.x, nextPointer.y),
        disableSnap: Boolean(moveEvent?.evt?.shiftKey),
      });
    });
    stage.on(`pointerup${namespace} mouseup${namespace} touchend${namespace}`, () => endDrag(true));
    stage.on(`pointercancel${namespace} touchcancel${namespace}`, () => endDrag(false));
    stage.on(`mouseleave${namespace}`, () => endDrag(true));
  }, [
    allPanels, clearHints, defaultAngleDeg, endDrag, gapPx, gapXPx, gapYPx,
    onDragStart, onSelect, prepareValidateCandidate, roofId, setGuide, snapTuningImg, stageToImg,
  ]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !draggingIdRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      endDrag(false);
    };
    const onBlur = () => {
      if (draggingIdRef.current) endDrag(false);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      frameRef.current?.cancel();
      try { stageRef.current?.off('.paneldrag'); } catch { }
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, [endDrag]);

  return { startDrag, hintURef, hintVRef };
}
