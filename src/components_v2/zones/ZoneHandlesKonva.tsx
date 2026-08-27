'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
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
  const [dragValid, setDragValid] = useState(true);
  const [livePoints, setLivePoints] = useState<Pt[] | null>(null);
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = livePoints ?? points;
  const dragStartPointsRef = useRef<Pt[] | null>(null);
  const frameRef = useRef<FrameScheduler<{ point: Pt; disableSnap: boolean }> | null>(null);
  const livePointsRef = useRef<Pt[] | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const endDrag = useCallback((commit = true) => {
    frameRef.current?.flush();
    const st = stageRef.current;
    if (st) st.off('.zonedrag');
    if (commit && livePointsRef.current) onChange(livePointsRef.current);
    frameRef.current?.cancel();
    activeRef.current = null;
    setActive(null);
    setDragValid(true);
    dragStartPointsRef.current = null;
    livePointsRef.current = null;
    setLivePoints(null);
    onDragEnd?.();
  }, [onDragEnd, onChange]);

  const startDrag = useCallback((i: number, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('button' in e.evt && e.evt.button !== 0) return;
    e.cancelBubble = true;
    setActive(i);
    activeRef.current = i;
    const initial = points.map((point) => ({ ...point }));
    dragStartPointsRef.current = initial;
    livePointsRef.current = initial;
    setLivePoints(initial);
    setDragValid(true);
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
      setDragValid(result.accepted);
      if (result.accepted) {
        livePointsRef.current = result.points;
        setLivePoints(result.points);
      }
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
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      frameRef.current?.cancel();
      stageRef.current?.off('.zonedrag');
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [endDrag, onChange]);

  const displayedPoints = livePoints ?? points;
  const flat = displayedPoints.flatMap(p => [p.x, p.y]);

  return (
    <>
      {/* bordo tratteggiato come feedback, opzionale */}
      <KonvaLine
        points={flat}
        closed
        fill={livePoints ? plannerTheme.dangerSoft : undefined}
        stroke={plannerTheme.danger}
        strokeWidth={1}
        dash={[6, 6]}
        listening={false}
      />
      {active !== null && displayedPoints.length >= 3 && (
        <KonvaLine
          points={[
            displayedPoints[(active - 1 + displayedPoints.length) % displayedPoints.length].x,
            displayedPoints[(active - 1 + displayedPoints.length) % displayedPoints.length].y,
            displayedPoints[active].x,
            displayedPoints[active].y,
            displayedPoints[(active + 1) % displayedPoints.length].x,
            displayedPoints[(active + 1) % displayedPoints.length].y,
          ]}
          stroke={dragValid ? plannerTheme.primary : plannerTheme.warning}
          strokeWidth={2}
          listening={false}
        />
      )}
      {displayedPoints.map((p, i) => (
        <KonvaCircle
          key={i}
          x={p.x}
          y={p.y}
          radius={active === i || hovered === i ? 4.5 : 4}
          fill={active === i && !dragValid ? plannerTheme.warning : hovered === i ? plannerTheme.primarySoft : plannerTheme.textLight}
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
