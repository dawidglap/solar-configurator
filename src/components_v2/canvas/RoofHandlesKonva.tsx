'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle as KonvaCircle } from 'react-konva';

type Pt = { x: number; y: number };

export default function RoofHandlesKonva({
  points,
  imgW,
  imgH,
  toImg,                // (stageX, stageY) -> coords immagine
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
  const activeRef = useRef<number | null>(null);              // <-- usare ref, non state
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = points;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const endDrag = useCallback(() => {
    const st = stageRef.current;
    if (st) st.off('.roofdrag');
    activeRef.current = null;
    setActive(null);
    onDragEnd?.();
  }, [onDragEnd]);

  const startDrag = useCallback((i: number, e: any) => {
    e.cancelBubble = true;                                      // non propagare al poligono
    setActive(i);
    activeRef.current = i;                                      // <-- salva l’indice attivo
    onDragStart?.();

    const st = e.target.getStage();
    stageRef.current = st;

    const ns = '.roofdrag';
    st.off(ns); // safety

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const idx = activeRef.current;
      if (idx === null) return;
      const pos = st.getPointerPosition();
      if (!pos) return;
      const p = toImg(pos.x, pos.y);
      const nx = clamp(p.x, 0, imgW);
      const ny = clamp(p.y, 0, imgH);
      const src = ptsRef.current;
      const next = src.map((pt, j) => (j === idx ? { x: nx, y: ny } : pt));
      onChange(next);
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [imgW, imgH, onChange, onDragStart, endDrag, toImg]);

  useEffect(() => {
    return () => stageRef.current?.off('.roofdrag');
  }, []);

  return (
    <>
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          x={p.x}
          y={p.y}
          radius={3}
          fill="#fff"
          stroke="#a855f7"
          strokeWidth={1}
          // niente draggable: drag manuale
          onMouseDown={(e) => startDrag(i, e)}
          onTouchStart={(e) => startDrag(i, e)}
          onMouseEnter={(e) => {
            const st = e.target.getStage();
            if (st?.container()) st.container().style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            if (active !== null) return;
            const st = e.target.getStage();
            if (st?.container()) st.container().style.cursor = 'default';
          }}
          hitStrokeWidth={16}
          listening
        />
      ))}
    </>
  );
}
