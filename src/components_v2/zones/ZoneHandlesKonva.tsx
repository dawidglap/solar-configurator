'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Circle as KonvaCircle, Line as KonvaLine } from 'react-konva';
import { plannerTheme } from '../theme/plannerTheme';
import { moveZoneVertex } from './zoneVertexEditing';

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
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = points;
  const dragStartPointsRef = useRef<Pt[] | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const endDrag = useCallback(() => {
    const st = stageRef.current;
    if (st) st.off('.zonedrag');
    activeRef.current = null;
    setActive(null);
    setDragValid(true);
    dragStartPointsRef.current = null;
    onDragEnd?.();
  }, [onDragEnd]);

  const startDrag = useCallback((i: number, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('button' in e.evt && e.evt.button !== 0) return;
    e.cancelBubble = true;
    setActive(i);
    activeRef.current = i;
    dragStartPointsRef.current = ptsRef.current.map((point) => ({ ...point }));
    setDragValid(true);
    onDragStart?.();

    const st = e.target.getStage();
    if (!st) return;
    stageRef.current = st;

    const ns = '.zonedrag';
    st.off(ns);

    st.on('mousemove' + ns + ' touchmove' + ns, (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const idx = activeRef.current;
      if (idx === null) return;
      const pos = st.getPointerPosition();
      if (!pos) return;
      const p = toImg(pos.x, pos.y); // ← coord immagine
      const nx = clamp(p.x, 0, imgW);
      const ny = clamp(p.y, 0, imgH);
      const src = ptsRef.current;
      const result = moveZoneVertex({
        points: src,
        vertexIndex: idx,
        requestedPoint: { x: nx, y: ny },
        ownerRoof: ownerRoofPoints,
        snapTolerancePx: snapRadiusImg,
        disableSnap: Boolean(event?.evt?.shiftKey),
        minAdjacentDistancePx: 1,
      });
      setDragValid(result.accepted);
      if (result.accepted) onChange(result.points);
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [imgW, imgH, toImg, onDragStart, ownerRoofPoints, snapRadiusImg, onChange, endDrag]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (dragStartPointsRef.current) onChange(dragStartPointsRef.current);
      endDrag();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      stageRef.current?.off('.zonedrag');
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [endDrag, onChange]);

  const flat = points.flatMap(p => [p.x, p.y]);

  return (
    <>
      {/* bordo tratteggiato come feedback, opzionale */}
      <KonvaLine
        points={flat}
        closed
        stroke={plannerTheme.danger}
        strokeWidth={1}
        dash={[6, 6]}
        listening={false}
      />
      {active !== null && points.length >= 3 && (
        <KonvaLine
          points={[
            points[(active - 1 + points.length) % points.length].x,
            points[(active - 1 + points.length) % points.length].y,
            points[active].x,
            points[active].y,
            points[(active + 1) % points.length].x,
            points[(active + 1) % points.length].y,
          ]}
          stroke={dragValid ? plannerTheme.primary : plannerTheme.warning}
          strokeWidth={2}
          listening={false}
        />
      )}
      {points.map((p, i) => (
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
