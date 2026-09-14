'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { Circle as KonvaCircle, Line as KonvaLine } from 'react-konva';
import { plannerTheme } from '../theme/plannerTheme';
import { moveZoneVertex } from './zoneVertexEditing';
import { createLatestFrameScheduler, type FrameScheduler } from '../canvas/performance/latestFrameScheduler';

type Pt = { x: number; y: number };

export default function ZoneHandlesKonva({
  points,
  ownerRoofPoints,
  imgW,
  imgH,
  toImg,                // (stageX, stageY) → coord immagine
  snapRadiusImg,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  points: Pt[];
  ownerRoofPoints: Pt[];
  imgW: number;
  imgH: number;
  toImg: (sx: number, sy: number) => Pt;
  snapRadiusImg: number;
  onChange: (next: Pt[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const dragStartPointsRef = useRef<Pt[] | null>(null);
  const frameRef = useRef<FrameScheduler<{ point: Pt; disableSnap: boolean }> | null>(null);
  const livePointsRef = useRef<Pt[] | null>(null);
  const polygonRef = useRef<Konva.Line | null>(null);
  const activeLineRef = useRef<Konva.Line | null>(null);
  const handleRefs = useRef<Array<Konva.Circle | null>>([]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const endDrag = useCallback((commit = true) => {
    if (activeRef.current === null) return;
    frameRef.current?.flush();
    const st = stageRef.current;
    if (st) st.off('.zonedrag');
    if (commit && livePointsRef.current) onChange(livePointsRef.current);
    frameRef.current?.cancel();
    activeRef.current = null;
    setActive(null);
    dragStartPointsRef.current = null;
    const restored = commit && livePointsRef.current ? livePointsRef.current : points;
    restored.forEach((point, index) => {
      handleRefs.current[index]?.position(point);
      handleRefs.current[index]?.fill(plannerTheme.textLight);
    });
    polygonRef.current?.points(restored.flatMap((point) => [point.x, point.y]));
    activeLineRef.current?.visible(false);
    activeLineRef.current?.stroke(plannerTheme.primary);
    polygonRef.current?.getLayer()?.batchDraw();
    livePointsRef.current = null;
    onDragEnd?.();
  }, [onDragEnd, onChange, points]);

  const startDrag = useCallback((i: number, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('button' in e.evt && e.evt.button !== 0) return;
    e.cancelBubble = true;
    setActive(i);
    activeRef.current = i;
    const initial = points.map((point) => ({ ...point }));
    dragStartPointsRef.current = initial;
    livePointsRef.current = initial;
    polygonRef.current?.points(initial.flatMap((point) => [point.x, point.y]));
    onDragStart?.();

    const st = e.target.getStage();
    if (!st) return;
    stageRef.current = st;

    const ns = '.zonedrag';
    st.off(ns);

    frameRef.current = createLatestFrameScheduler(({ point, disableSnap }) => {
      const idx = activeRef.current;
      if (idx === null) return;
      const nx = clamp(point.x, 0, imgW);
      const ny = clamp(point.y, 0, imgH);
      const src = livePointsRef.current ?? initial;
      const result = moveZoneVertex({
        points: src,
        vertexIndex: idx,
        requestedPoint: { x: nx, y: ny },
        ownerRoof: ownerRoofPoints,
        snapTolerancePx: snapRadiusImg,
        disableSnap,
        minAdjacentDistancePx: 1,
      });
      const activeHandle = handleRefs.current[idx];
      activeHandle?.fill(result.accepted ? plannerTheme.textLight : plannerTheme.warning);
      activeLineRef.current?.stroke(result.accepted ? plannerTheme.primary : plannerTheme.warning);
      if (result.accepted) {
        livePointsRef.current = result.points;
        const point = result.points[idx];
        activeHandle?.position(point);
        polygonRef.current?.points(result.points.flatMap((candidate) => [candidate.x, candidate.y]));
        const previous = result.points[(idx - 1 + result.points.length) % result.points.length];
        const next = result.points[(idx + 1) % result.points.length];
        activeLineRef.current?.points([previous.x, previous.y, point.x, point.y, next.x, next.y]);
        activeLineRef.current?.visible(true);
      }
      polygonRef.current?.getLayer()?.batchDraw();
    });

    st.on('mousemove' + ns + ' touchmove' + ns, (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = st.getPointerPosition();
      if (!pos) return;
      frameRef.current?.schedule({
        point: toImg(pos.x, pos.y),
        disableSnap: Boolean(event?.evt?.shiftKey),
      });
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, () => endDrag(true));
    st.on('pointercancel' + ns + ' touchcancel' + ns, () => endDrag(false));
    st.on('mouseleave' + ns, () => endDrag(true));
  }, [imgW, imgH, toImg, onDragStart, ownerRoofPoints, snapRadiusImg, points, endDrag]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      endDrag(false);
    };
    const onBlur = () => endDrag(false);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      frameRef.current?.cancel();
      stageRef.current?.off('.zonedrag');
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, [endDrag, onChange]);

  const flat = points.flatMap(p => [p.x, p.y]);

  return (
    <>
      {/* bordo tratteggiato come feedback, opzionale */}
      <KonvaLine
        ref={polygonRef}
        points={flat}
        closed
        fill={plannerTheme.dangerSoft}
        stroke={plannerTheme.danger}
        strokeWidth={1}
        dash={[6, 6]}
        listening={false}
      />
      <KonvaLine
        ref={activeLineRef}
        points={[]}
        stroke={plannerTheme.primary}
        strokeWidth={2}
        listening={false}
        visible={false}
        perfectDrawEnabled={false}
      />
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          ref={(node) => { handleRefs.current[i] = node; }}
          x={p.x}
          y={p.y}
          radius={active === i || hovered === i ? 4.5 : 4}
          fill={hovered === i ? plannerTheme.primarySoft : plannerTheme.textLight}
          stroke={plannerTheme.danger}
          strokeWidth={1}
          onMouseDown={(e) => startDrag(i, e)}
          onTouchStart={(e) => startDrag(i, e)}
          onMouseEnter={(e) => {
            setHovered(i);
            const st = e.target.getStage();
            const container = st?.container();
            if (container) container.style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            setHovered(null);
            if (active !== null) return;
            const st = e.target.getStage();
            const container = st?.container();
            if (container) container.style.cursor = 'default';
          }}
          hitStrokeWidth={20}
          listening
        />
      ))}
    </>
  );
}
