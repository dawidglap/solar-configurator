// src/components_v2/canvas/RoofHandlesKonva.tsx
'use client';

import { useCallback, useEffect, useRef } from 'react';
import type Konva from 'konva';
import { Circle as KonvaCircle, Line as KonvaLine } from 'react-konva';
import { plannerTheme } from '../theme/plannerTheme';
import { createLatestFrameScheduler, type FrameScheduler } from './performance/latestFrameScheduler';

type Pt = { x: number; y: number };

export default function RoofHandlesKonva({
  roofId,
  points,
  imgW,
  imgH,
  toImg,                  // (stageX, stageY) -> coords immagine
  getSnapTargets,         // () => Array<{ roofId, index, x, y }>
  snapRadiusImg,          // raggio di snap in px immagine
  onChange,
  onDragStart,
  onDragEnd,
}: {
  roofId: string;
  points: Pt[];
  imgW: number;
  imgH: number;
  toImg: (sx: number, sy: number) => Pt;
  getSnapTargets: () => { roofId: string; index: number; x: number; y: number }[];
  snapRadiusImg: number;
  onChange: (next: Pt[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  // --- stato/refs base
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const livePointsRef = useRef<Pt[] | null>(null);
  const frameRef = useRef<FrameScheduler<{ x: number; y: number }> | null>(null);
  const polygonRef = useRef<Konva.Line | null>(null);
  const snapRef = useRef<Konva.Circle | null>(null);
  const handleRefs = useRef<Array<Konva.Circle | null>>([]);

  // --- stato per highlight snap
  const activeRoofIdRef = useRef<string>(roofId);
  useEffect(() => {
    activeRoofIdRef.current = roofId;
  }, [roofId]);

  // --- utils
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const nearestTarget = useCallback((imgX: number, imgY: number, activeIndex: number) => {
    const cand = getSnapTargets();
    let best: null | { x: number; y: number; d: number } = null;
    for (const t of cand) {
      // ignora il punto identico a se stesso
      if (t.roofId === activeRoofIdRef.current && t.index === activeIndex) continue;
      const dx = t.x - imgX,
        dy = t.y - imgY;
      const d = Math.hypot(dx, dy);
      if (d <= snapRadiusImg && (!best || d < best.d)) best = { x: t.x, y: t.y, d };
    }
    return best;
  }, [getSnapTargets, snapRadiusImg]);

  // ── Deduplica vertici coincidenti entro una soglia ε (px immagine)
function dedupCoincident(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 3) return pts;
  const out: Pt[] = [];
  for (const p of pts) {
    const found = out.find(q => Math.hypot(p.x - q.x, p.y - q.y) <= eps);
    if (!found) out.push({ x: p.x, y: p.y });
  }
  // mantieni un poligono valido (min 3 vertici); altrimenti non toccare
  return out.length >= 3 ? out : pts;
}


const endDrag = useCallback((commit = true) => {
  if (activeRef.current === null) return;
  frameRef.current?.flush();
  const st = stageRef.current;
  if (st) st.off('.roofdrag');

  const src = livePointsRef.current ?? points;
  const eps = Math.max(1, snapRadiusImg * 0.8);   // soglia vicina al raggio snap
  const deduped = dedupCoincident(src, eps);
  if (commit) onChange(deduped);

  const restored = commit ? deduped : points;
  restored.forEach((point, index) => handleRefs.current[index]?.position(point));
  polygonRef.current?.visible(false);
  snapRef.current?.visible(false);
  polygonRef.current?.getLayer()?.batchDraw();

  frameRef.current?.cancel();
  livePointsRef.current = null;
  activeRef.current = null;
  onDragEnd?.();
}, [onDragEnd, snapRadiusImg, onChange, points]);


  const startDrag = useCallback(
    (i: number, e: any) => {
      // Right-click belongs to the Stage pan lifecycle, even directly over a
      // vertex handle. Touch events have no mouse button and remain valid.
      if (typeof e?.evt?.button === 'number' && e.evt.button !== 0) return;
      e.cancelBubble = true; // non propagare al poligono
      activeRef.current = i;
      const initial = points.map((point) => ({ ...point }));
      livePointsRef.current = initial;
      polygonRef.current?.points(initial.flatMap((point) => [point.x, point.y]));
      polygonRef.current?.visible(true);
      onDragStart?.();

      const st = e.target.getStage();
      if (!st) return; // guardia
      stageRef.current = st;

      const ns = '.roofdrag';
      st.off(ns); // safety

      frameRef.current = createLatestFrameScheduler(({ x, y }) => {
        const idx = activeRef.current;
        if (idx === null) return;
        const nx = clamp(x, 0, imgW);
        const ny = clamp(y, 0, imgH);
        const src = livePointsRef.current ?? initial;

        // SNAP VERTEX-VERTEX (se c'è hit, usiamo le coords del target)
        const hit = nearestTarget(nx, ny, idx);
        const point = hit ? { x: hit.x, y: hit.y } : { x: nx, y: ny };
        const next = src.map((pt, j) => (j === idx ? point : pt));
        livePointsRef.current = next;
        handleRefs.current[idx]?.position(point);
        polygonRef.current?.points(next.flatMap((candidate) => [candidate.x, candidate.y]));
        if (snapRef.current) {
          snapRef.current.position(point);
          snapRef.current.visible(Boolean(hit));
        }
        polygonRef.current?.getLayer()?.batchDraw();
      });

      st.on('mousemove' + ns + ' touchmove' + ns, () => {
        const pos = st.getPointerPosition();
        if (!pos) return;
        frameRef.current?.schedule(toImg(pos.x, pos.y));
      });

      st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, () => endDrag(true));
      st.on('pointercancel' + ns + ' touchcancel' + ns, () => endDrag(false));
      st.on('mouseleave' + ns, () => endDrag(true));
    },
    [imgW, imgH, toImg, onDragStart, endDrag, nearestTarget, points]
  );

  // cleanup
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      endDrag(false);
    };
    const onBlur = () => endDrag(false);
    window.addEventListener('keydown', onEscape, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      frameRef.current?.cancel();
      stageRef.current?.off('.roofdrag');
      window.removeEventListener('keydown', onEscape, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, [endDrag]);

  return (
    <>
      <KonvaLine
        ref={polygonRef}
        points={[]}
        closed
        stroke={plannerTheme.primary}
        strokeWidth={1}
        listening={false}
        visible={false}
        perfectDrawEnabled={false}
      />
      {/* maniglie vertici */}
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          ref={(node) => { handleRefs.current[i] = node; }}
          x={p.x}
          y={p.y}
          radius={3}
          fill="#fff"
          stroke="#a855f7"
          strokeWidth={1}
          // Keep the visible marker compact while making the pointer target
          // forgiving on dense/overlapping roof geometry.
          hitStrokeWidth={20}
          listening
          onMouseDown={(e) => startDrag(i, e)}
          onTouchStart={(e) => startDrag(i, e)}
          onMouseEnter={(e) => {
            const st = e.target.getStage();
            st?.container()?.style.setProperty('cursor', 'pointer');
          }}
          onMouseLeave={(e) => {
            if (activeRef.current !== null) return;
            const st = e.target.getStage();
            st?.container()?.style.setProperty('cursor', 'default');
          }}
        />
      ))}

      {/* highlight target di snap */}
      <KonvaCircle
        ref={snapRef}
        x={0}
        y={0}
        radius={6}
        stroke="#10b981"
        strokeWidth={2}
        fill="rgba(16,185,129,0.15)"
        listening={false}
        visible={false}
      />
    </>
  );
}
