'use client';

import React, { useMemo, useRef } from 'react';
import {
  Group as KonvaGroup,
  Line as KonvaLine,
  Text as KonvaText,
  Path as KonvaPath,
  Circle as KonvaCircle,
    Rect as KonvaRect,   
} from 'react-konva';
import RoofHandlesKonva from './RoofHandlesKonva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { rotateAround } from '@/components_v2/roofs/alignment';
import { TbRotateClockwise2 } from 'react-icons/tb';
import Konva from 'konva';
// in cima al file



type Pt = { x: number; y: number };
type LayerRoof = { id: string; points: Pt[]; azimuthDeg?: number };

function toFlat(pts: Pt[]) { return pts.flatMap(p => [p.x, p.y]); }
function centroid(pts: Pt[]) {
  let sx = 0, sy = 0; for (const p of pts) { sx += p.x; sy += p.y; }
  const n = pts.length || 1; return { x: sx / n, y: sy / n };
}
function rotatePolygon(pts: Pt[], pivot: Pt, deg: number) {
  if (!deg) return pts;
  return pts.map(p => rotateAround(p, pivot, deg));
}

function edgeMeta(pts: Pt[]) {
  const arr: {
    i: number; j: number;
    mx: number; my: number;
    nx: number; ny: number;   // normale unitaria del lato (una delle due)
    angleDeg: number;         // orientamento del lato (per ruotare l'handle)
    cursor: 'ns-resize' | 'ew-resize';
  }[] = [];

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pts[i], b = pts[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    // normale (perpendicolare) unitaria: (-dy, dx)/len
    const nx = -dy / len;
    const ny =  dx / len;

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const cursor = Math.abs(dx) >= Math.abs(dy) ? 'ns-resize' : 'ew-resize';

    arr.push({ i, j, mx, my, nx, ny, angleDeg, cursor });
  }
  return arr;
}


// Estrai i path dell’icona rotazione
function iconToPaths(IconComp: any): {
  paths: string[];
  vbW: number; vbH: number;
  strokeW: number; linecap: 'round'|'butt'|'square'; linejoin: 'round'|'miter'|'bevel';
} {
  const el = IconComp({});
  const vb: string = el.props.viewBox ?? '0 0 24 24';
  const [, , vbW, vbH] = vb.split(' ').map((n: string) => Number(n));
  const children = React.Children.toArray(el.props.children) as any[];
  const paths = children.filter((c: any) => c?.props?.d).map((c: any) => c.props.d as string);

  return {
    paths,
    vbW: vbW || 24,
    vbH: vbH || 24,
    strokeW: Number(el.props.strokeWidth ?? 2),
    linecap: (el.props.strokeLinecap ?? 'round') as any,
    linejoin: (el.props.strokeLinejoin ?? 'round') as any,
  };
}

export default function RoofShapesLayer({
  layers,
  selectedId,
  onSelect,
  showAreaLabels,
  stroke,
  strokeSelected,
  fill,
  strokeWidthNormal,
  strokeWidthSelected,
  shapeMode,
  toImg, // (stageX, stageY) -> px immagine
  imgW,
  imgH,
  onHandlesDragStart,
  onHandlesDragEnd,
  areaLabel,
}: {
  layers: LayerRoof[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  showAreaLabels: boolean;
  stroke: string;
  strokeSelected: string;
  fill: string;
  strokeWidthNormal: number;
  strokeWidthSelected: number;
  shapeMode: 'normal' | 'trapezio';
  toImg: (x: number, y: number) => Pt;
  imgW: number;
  imgH: number;
  onHandlesDragStart: () => void;
  onHandlesDragEnd: () => void;
  areaLabel: (pts: Pt[]) => string | null;
}) {
  const updateRoof = usePlannerV2Store(s => s.updateRoof);

  // stato UI rotazione/pivot
  const { rotDeg, pivotPx } = usePlannerV2Store(s => s.roofAlign ?? { rotDeg: 0, pivotPx: undefined });
  const setRoofRotDeg = usePlannerV2Store(s => s.setRoofRotDeg);

  // refs per drag rotazione
  const dragStartAngleRef = useRef(0);
  const dragStartDegRef   = useRef(0);
  const startPtsRef       = useRef<Pt[] | null>(null);
  const startPivotRef     = useRef<Pt | null>(null);

  const startAzimuthRef   = useRef<number>(0);
const lastNextDegRef    = useRef<number>(0);

  // refs per drag MOVE (traslazione)
  const moveStartPtrImgRef = useRef<Pt | null>(null);
  const moveStartPtsRef    = useRef<Pt[] | null>(null);

  // icona rotazione in path
  const ROT_ICON = useMemo(() => iconToPaths(TbRotateClockwise2), []);
  

  const HANDLE_R  = 0;   // raggio offset icona rotazione (0 = al pivot)
  const HANDLE_SZ = 10;  // size icona rotazione


  return (
    <>
      {layers.map(r => {
        const sel = r.id === selectedId;

        // pivot: se non definito, centroide
        const selPivot = sel ? (pivotPx ?? centroid(r.points)) : undefined;

        // pts correnti (baked)
        const pts = r.points;
        const flat = toFlat(pts);
        const c = centroid(pts);
        const label = showAreaLabels ? areaLabel(pts) : null;

        const rotHandlePos = (sel && selPivot)
          ? {
              x: selPivot.x + HANDLE_R * Math.cos((rotDeg * Math.PI) / 180),
              y: selPivot.y + HANDLE_R * Math.sin((rotDeg * Math.PI) / 180),
            }
          : null;

    

        return (
          <KonvaGroup key={r.id}>
          <KonvaLine
  points={flat}
  closed
  stroke={sel ? strokeSelected : stroke}
  strokeWidth={sel ? strokeWidthSelected : strokeWidthNormal}
  lineJoin="round"
  lineCap="round"
  fill={fill}
  onClick={() => onSelect(r.id)}
  shadowColor={sel ? strokeSelected : 'transparent'}
  shadowBlur={sel ? 6 : 0}
  shadowOpacity={sel ? 0.9 : 0}
  hitStrokeWidth={12}

  // 👇 NUOVO: cursore "move" quando è selezionata
  onMouseEnter={(e) => {
    if (!sel) return;
    e.target.getStage()?.container()?.style.setProperty('cursor', 'move');
  }}
  onMouseLeave={(e) => {
    if (!sel) return;
    e.target.getStage()?.container()?.style.removeProperty('cursor');
  }}

  // 👇 NUOVO: drag dell'intera falda cliccando sulla shape
  onMouseDown={(e) => {
    if (!sel) return;          // drag solo se la falda è già selezionata
    e.cancelBubble = true;

    const st = e.target.getStage();
    if (!st) return;
    const ns = '.roof-move-poly';
    st.off(ns);

    // blocca pan durante il drag
    onHandlesDragStart();

    // snapshot iniziale (px immagine)
    moveStartPtsRef.current = r.points.map(p => ({ ...p }));
    const pos = st.getPointerPosition();
    if (!pos) return;
    moveStartPtrImgRef.current = toImg(pos.x, pos.y); // STAGE→IMG

    st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
      const cur = st.getPointerPosition();
      if (!cur || !moveStartPtsRef.current || !moveStartPtrImgRef.current) return;
      const curImg = toImg(cur.x, cur.y); // STAGE→IMG

      let dx = curImg.x - moveStartPtrImgRef.current.x;
      let dy = curImg.y - moveStartPtrImgRef.current.y;

      // Shift = vincolo asse dominante
      const shift = ev?.evt?.shiftKey;
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }

      const moved = moveStartPtsRef.current.map(p => ({ x: p.x + dx, y: p.y + dy }));
      updateRoof(r.id, { points: moved });

      
    });

    const end = () => {
      st.off(ns);
      moveStartPtrImgRef.current = null;
      moveStartPtsRef.current = null;
      onHandlesDragEnd(); // sblocca pan
    };
    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
  }}
/>

{/* ─── HANDLE PARALLELO LATO: shapeMode=normal ───────────────────────────── */}
{sel && shapeMode === 'normal' && edgeMeta(pts).map((e, k) => (
  <KonvaGroup
    key={`edge-h-${k}`}
    x={e.mx}
    y={e.my}
    onMouseEnter={(ev) => {
      ev.target.getStage()?.container()?.style.setProperty('cursor', e.cursor);
    }}
    onMouseLeave={(ev) => {
      ev.target.getStage()?.container()?.style.removeProperty('cursor');
    }}
  >
    {/* RUOTA la maniglia per allinearla al lato */}
    <KonvaGroup rotation={e.angleDeg}>
      {/* Maniglia stile Canva (fa anche da hit-area) */}
   <KonvaRect
  x={-12} y={-2} width={24} height={6} cornerRadius={6.5}
  fill="#ffffff"                  // bianco di base
  stroke="#fff"
  strokeWidth={0.5}
  shadowColor="rgba(0,0,0,0.25)"
  shadowBlur={3}
  shadowOpacity={0.9}
  onMouseEnter={(ev) => {        // HOVER → verde
    const rect = ev.target as Konva.Rect;
    rect.fill('#2269c5');        // green-500
    rect.stroke('#164aa3');      // green-600
    rect.getLayer()?.batchDraw();
  }}
  onMouseLeave={(ev) => {        // esci da hover → torna bianco
    const rect = ev.target as Konva.Rect;
    rect.fill('#ffffff');
    rect.stroke('#fff');
    rect.getLayer()?.batchDraw();
  }}
  onMouseDown={(ev) => {
    ev.cancelBubble = true;
    const st = ev.target.getStage(); if (!st) return;
    const ns = `.roof-edge-${k}`;
    st.off(ns);

    onHandlesDragStart();

    // snapshot iniziale
    moveStartPtsRef.current = r.points.map(p => ({ ...p }));
    const pos = st.getPointerPosition(); if (!pos) return;
    moveStartPtrImgRef.current = toImg(pos.x, pos.y); // STAGE→IMG

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const cur = st.getPointerPosition();
      if (!cur || !moveStartPtsRef.current || !moveStartPtrImgRef.current) return;
      const curImg = toImg(cur.x, cur.y);

      const dx = curImg.x - moveStartPtrImgRef.current.x;
      const dy = curImg.y - moveStartPtrImgRef.current.y;

      const t = dx * e.nx + dy * e.ny;                 // proiezione sulla normale
      const off = { x: e.nx * t, y: e.ny * t };

      const next = moveStartPtsRef.current.map((p, idx) =>
        (idx === e.i || idx === e.j) ? { x: p.x + off.x, y: p.y + off.y } : p
      );

      updateRoof(r.id, { points: next });
    });

    const end = () => {
      st.off(ns);
      moveStartPtrImgRef.current = null;
      moveStartPtsRef.current = null;
      onHandlesDragEnd();
    };
    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
  }}
/>

      {/* segnetto centrale puramente estetico */}
      {/* <KonvaLine points={[-10, 0, 10, 0]} stroke="#334155" strokeWidth={1} listening={false} /> */}
    </KonvaGroup>
  </KonvaGroup>
))}





            {showAreaLabels && label && (
              <KonvaText
                x={c.x}
                y={c.y}
                text={label}
                fontSize={12}
                fill="#111"
                offsetX={18}
                offsetY={-6}
                listening={false}
                // @ts-ignore
                shadowColor="white"
                shadowBlur={2}
                shadowOpacity={0.9}
              />
            )}

            {/* ROTAZIONE (px immagine) */}
            {sel && selPivot && shapeMode !== 'trapezio' && rotHandlePos && (
              <KonvaGroup
                x={rotHandlePos.x}
                y={rotHandlePos.y}
                
                listening
                onMouseEnter={(e) => { e.target.getStage()?.container()?.style.setProperty('cursor','grab'); }}
                onMouseLeave={(e) => { e.target.getStage()?.container()?.style.removeProperty('cursor'); }}
             onMouseDown={(e) => {
  e.cancelBubble = true;
  const st = e.target.getStage();
  if (!st) return;
  const ns = '.roof-rotate';
  st.off(ns);

  // snapshot iniziale (px immagine)
  startPtsRef.current   = r.points.map(p => ({ ...p }));
  startPivotRef.current = selPivot;

  // ⬇️ NEW: azimuth di partenza della falda
  startAzimuthRef.current = r.azimuthDeg ?? 0;

  const pos = st.getPointerPosition();
  if (!pos) return;
  const pImg = toImg(pos.x, pos.y); // STAGE→IMG (px immagine)
  dragStartAngleRef.current = Math.atan2(pImg.y - selPivot.y, pImg.x - selPivot.x);
  dragStartDegRef.current   = rotDeg || 0;

  st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
    const cur = st.getPointerPosition();
    if (!cur || !startPtsRef.current || !startPivotRef.current) return;
    const qImg = toImg(cur.x, cur.y); // STAGE→IMG (px immagine)
    const a = Math.atan2(qImg.y - startPivotRef.current.y, qImg.x - startPivotRef.current.x);
    let deltaDeg = (a - dragStartAngleRef.current) * (180 / Math.PI);

    const nextDeg = ev?.evt?.shiftKey
      ? Math.round((dragStartDegRef.current + deltaDeg) / 15) * 15
      : (dragStartDegRef.current + deltaDeg);

    // ⬇️ NEW: tieni traccia dell'ultimo valore
    lastNextDegRef.current = nextDeg;

    setRoofRotDeg(nextDeg);

    const rotated = rotatePolygon(startPtsRef.current, startPivotRef.current, nextDeg);
    updateRoof(r.id, { points: rotated });
  });

  const end = () => {
    st.off(ns);

    // ⬇️ NEW: a fine drag, accumula il delta sull'azimuth della falda
    const delta = lastNextDegRef.current - (dragStartDegRef.current || 0);
    const rawAz = startAzimuthRef.current + delta;
    // normalizza 0..360 (facoltativo)
    const newAz = ((rawAz % 360) + 360) % 360;

    updateRoof(r.id, { azimuthDeg: newAz });

    // reset UI rotdeg
    setRoofRotDeg(0);
  };
  st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
}}

              >
                {/* disco sfondo */}
                <KonvaCircle
                  radius={HANDLE_SZ / 2}
                  fill="#ffffff"
                  opacity={0.75}
                  stroke="#cbd5e1"
                  strokeWidth={0.25}
                  shadowColor="rgba(0,0,0,0.25)"
                  shadowBlur={4}
                  shadowOpacity={0.9}
                />
                {/* icona path */}
                {(() => {
                  const scale = HANDLE_SZ / ROT_ICON.vbW;
                  const strokePx = 1;
                  const strokeWidth = strokePx / scale; // spessore costante visivo
                  return ROT_ICON.paths.map((d, i) => (
                    <KonvaPath
                      key={i}
                      data={d}
                      scaleX={scale}
                      scaleY={scale}
                      offsetX={ROT_ICON.vbW / 2}
                      offsetY={ROT_ICON.vbH / 2}

                      stroke="#334155"
                      strokeWidth={strokeWidth}
                      lineCap={ROT_ICON.linecap}
                      lineJoin={ROT_ICON.linejoin}
                      listening={false}
                    />
                  ));
                })()}
              </KonvaGroup>
            )}

         

            {/* Maniglie TRAPEZIO */}
            {sel && shapeMode === 'trapezio' && (
              <RoofHandlesKonva
                points={r.points}
                imgW={imgW}
                imgH={imgH}
                toImg={toImg}
                onDragStart={onHandlesDragStart}
                onDragEnd={onHandlesDragEnd}
                onChange={(next) => updateRoof(r.id, { points: next })}
              />
            )}
          </KonvaGroup>
        );
      })}
    </>
  );
}
