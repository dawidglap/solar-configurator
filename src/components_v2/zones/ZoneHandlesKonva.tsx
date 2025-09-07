'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle as KonvaCircle, Line as KonvaLine } from 'react-konva';

type Pt = { x: number; y: number };

export default function ZoneHandlesKonva({
  points,
  imgW,
  imgH,
  toImg,                // (stageX, stageY) → coord immagine
  onChange,
  onDragStart,
  onDragEnd,
}: {
  points: Pt[];
  imgW: number;
  imgH: number;
  toImg: (sx: number, sy: number) => Pt;
  onChange: (next: Pt[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = points;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const endDrag = useCallback(() => {
    const st = stageRef.current;
    if (st) st.off('.zonedrag');
    activeRef.current = null;
    setActive(null);
    onDragEnd?.();
  }, [onDragEnd]);

  const startDrag = useCallback((i: number, e: any) => {
    e.cancelBubble = true;
    setActive(i);
    activeRef.current = i;
    onDragStart?.();

    const st = e.target.getStage();
    if (!st) return;
    stageRef.current = st;

    const ns = '.zonedrag';
    st.off(ns);

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const idx = activeRef.current;
      if (idx === null) return;
      const pos = st.getPointerPosition();
      if (!pos) return;
      const p = toImg(pos.x, pos.y); // ← coord immagine
      const nx = clamp(p.x, 0, imgW);
      const ny = clamp(p.y, 0, imgH);
      const src = ptsRef.current;
      const next = src.map((pt, j) => (j === idx ? { x: nx, y: ny } : pt));
      onChange(next);
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [imgW, imgH, toImg, onDragStart, onDragEnd, endDrag]);

  useEffect(() => {
    return () => {
      stageRef.current?.off('.zonedrag');
    };
  }, []);

  const flat = points.flatMap(p => [p.x, p.y]);

  return (
    <>
      {/* bordo tratteggiato come feedback, opzionale */}
      <KonvaLine
        points={flat}
        closed
        stroke="#ff2d55"
        strokeWidth={1}
        dash={[6, 6]}
        listening={false}
      />
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          x={p.x}
          y={p.y}
          radius={3}
          fill="#fff"
          stroke="#ff2d55"
          strokeWidth={1}
          onMouseDown={(e) => startDrag(i, e)}
          onTouchStart={(e) => startDrag(i, e)}
          onMouseEnter={(e) => {
            const st = e.target.getStage();
            st?.container() && (st.container().style.cursor = 'pointer');
          }}
          onMouseLeave={(e) => {
            if (active !== null) return;
            const st = e.target.getStage();
            st?.container() && (st.container().style.cursor = 'default');
          }}
          hitStrokeWidth={16}
          listening
        />
      ))}
    </>
  );
}
