// src/components_v2/canvas/RoofHandlesKonva.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle as KonvaCircle } from 'react-konva';

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
  const [active, setActive] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const stageRef = useRef<import('konva/lib/Stage').Stage | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = points;

  // --- stato per highlight snap
  const [hoverSnap, setHoverSnap] = useState<{ x: number; y: number } | null>(null);
  const activeRoofIdRef = useRef<string>(roofId);
  useEffect(() => {
    activeRoofIdRef.current = roofId;
  }, [roofId]);

  // --- utils
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  function nearestTarget(imgX: number, imgY: number, activeIndex: number) {
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
  }

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


const endDrag = useCallback(() => {
  const st = stageRef.current;
  if (st) st.off('.roofdrag');

  // ⬇️ DEDUP alla fine del drag (irrevocabile salvo undo)
  const src = ptsRef.current;
  const eps = Math.max(1, snapRadiusImg * 0.8);   // soglia vicina al raggio snap
  const deduped = dedupCoincident(src, eps);
  if (deduped !== src && deduped.length !== src.length) {
    onChange(deduped); // scrive lo stato "fuso"
  }

  activeRef.current = null;
  setActive(null);
  setHoverSnap(null); // pulisci highlight
  onDragEnd?.();
}, [onDragEnd, snapRadiusImg, onChange]);


  const startDrag = useCallback(
    (i: number, e: any) => {
      e.cancelBubble = true; // non propagare al poligono
      setActive(i);
      activeRef.current = i;
      onDragStart?.();

      const st = e.target.getStage();
      if (!st) return; // guardia
      stageRef.current = st;

      const ns = '.roofdrag';
      st.off(ns); // safety

      st.on('mousemove' + ns + ' touchmove' + ns, () => {
        const idx = activeRef.current;
        if (idx === null) return;
        const pos = st.getPointerPosition();
        if (!pos) return;

        // stage -> image coords
        const p = toImg(pos.x, pos.y);
        const nx = clamp(p.x, 0, imgW);
        const ny = clamp(p.y, 0, imgH);

        const src = ptsRef.current;

        // SNAP VERTEX-VERTEX (se c'è hit, usiamo le coords del target)
        const hit = nearestTarget(nx, ny, idx);
        if (hit) {
          setHoverSnap({ x: hit.x, y: hit.y });
          const snapped = src.map((pt, j) => (j === idx ? { x: hit.x, y: hit.y } : pt));
          onChange(snapped);
        } else {
          setHoverSnap(null);
          const next = src.map((pt, j) => (j === idx ? { x: nx, y: ny } : pt));
          onChange(next);
        }
      });

      st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
      st.on('mouseleave' + ns, endDrag);
    },
    [imgW, imgH, toImg, onChange, onDragStart, endDrag]
  );

  // cleanup
  useEffect(() => {
    return () => {
      stageRef.current?.off('.roofdrag');
    };
  }, []);

  return (
    <>
      {/* maniglie vertici */}
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          x={p.x}
          y={p.y}
          radius={3}
          fill="#fff"
          stroke="#a855f7"
          strokeWidth={1}
          hitStrokeWidth={16}
          listening
          onMouseDown={(e) => startDrag(i, e)}
          onTouchStart={(e) => startDrag(i, e)}
          onMouseEnter={(e) => {
            const st = e.target.getStage();
            st?.container()?.style.setProperty('cursor', 'pointer');
          }}
          onMouseLeave={(e) => {
            if (active !== null) return;
            const st = e.target.getStage();
            st?.container()?.style.setProperty('cursor', 'default');
          }}
        />
      ))}

      {/* highlight target di snap */}
      {hoverSnap && (
        <KonvaCircle
          x={hoverSnap.x}
          y={hoverSnap.y}
          radius={6}
          stroke="#10b981"
          strokeWidth={2}
          fill="rgba(16,185,129,0.15)"
          listening={false}
        />
      )}
    </>
  );
}
