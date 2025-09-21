'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
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
import { FaRotate } from 'react-icons/fa6';

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

function bbox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
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
// store actions
const updateRoof  = usePlannerV2Store(s => s.updateRoof);
const removeRoof  = usePlannerV2Store(s => s.removeRoof);

// stato UI rotazione/pivot
const { rotDeg, pivotPx } = usePlannerV2Store(s => s.roofAlign ?? { rotDeg: 0, pivotPx: undefined });
const setRoofRotDeg = usePlannerV2Store(s => s.setRoofRotDeg);

// refs per rotazione
const dragStartAngleRef = useRef(0);
const dragStartDegRef   = useRef(0);
const startPtsRef       = useRef<Pt[] | null>(null);
const startPivotRef     = useRef<Pt | null>(null);
const startAzimuthRef   = useRef<number>(0);
const lastNextDegRef    = useRef<number>(0);

// refs per move
const moveStartPtrImgRef = useRef<Pt | null>(null);
const moveStartPtsRef    = useRef<Pt[] | null>(null);

// === Multi-selezione (DEVE stare sopra agli useEffect che la usano)
const [groupSel, setGroupSel] = useState<string[]>([]);

// Snapshot punti per drag di gruppo (UNA sola dichiarazione)
const groupStartPtsRef = useRef<Record<string, Pt[]>>({});

// --- Keyboard: ESC per deselezionare, DELETE per eliminare selezionati
useEffect(() => {
  const isEditing = (el: any) => {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  };

  const onKey = (e: KeyboardEvent) => {
    if (isEditing(e.target)) return;

    if (e.key === 'Escape') {
      setGroupSel([]);
      onSelect(undefined);
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const ids = groupSel.length ? groupSel : (selectedId ? [selectedId] : []);
      if (!ids.length) return;
      e.preventDefault();
      ids.forEach(id => removeRoof(id));
      setGroupSel([]);
      onSelect(undefined);
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [groupSel, selectedId, removeRoof, onSelect]);

// --- Pulisci groupSel se i layers cambiano (es. dopo delete)
useEffect(() => {
  const existing = new Set(layers.map(l => l.id));
  setGroupSel(prev => prev.filter(id => existing.has(id)));
}, [layers]);

// icona e knob
const ROT_ICON = useMemo(() => iconToPaths(FaRotate), []);
const ROT_KNOB_OFFSET = 46;
const HANDLE_SZ = 16;





  return (
    <>
      {layers.map(r => {
        const sel = r.id === selectedId;

        // pivot: se non definito, centroide
        // const selPivot = sel ? (pivotPx ?? centroid(r.points)) : undefined;
        

        // pts correnti (baked)
        const pts = r.points;
        const flat = toFlat(pts);
        const c = centroid(pts);
        const label = showAreaLabels ? areaLabel(pts) : null;

        const isSel = sel || groupSel.includes(r.id);
        const multi  = groupSel.length > 0; 
        const inGroupOnly = !sel && groupSel.includes(r.id);
const strokeColor = sel ? strokeSelected : inGroupOnly ? '#7c3aed' : stroke;     // viola per secondarie
const strokeW     = sel ? strokeWidthSelected : inGroupOnly ? strokeWidthSelected : strokeWidthNormal;
const shadowOp    = (sel || inGroupOnly) ? 0.6 : 0;







const bb = bbox(pts);

// pivot di rotazione = centro del bbox (stile Canva). Se hai un pivot custom, lo rispettiamo.
 const rotPivot = isSel ? (pivotPx ?? { x: bb.cx, y: bb.cy }) : undefined;
const rotHandlePos = (isSel && rotPivot)
   ? { x: bb.cx, y: bb.minY - ROT_KNOB_OFFSET }
   : null;



    

        return (
          <KonvaGroup key={r.id}>
          <KonvaLine
  points={flat}
  closed
 

  lineJoin="round"
  lineCap="round"
  fill={fill}
onClick={(e) => {
  const withShift = !!(e.evt && e.evt.shiftKey);

  if (withShift) {
    // Avvio/gestione multi-selezione SENZA cambiare la primaria
    setGroupSel((prev) => {
      let base = prev;

      // Se non c'è ancora multi, semina l'array con la primaria corrente
      if (prev.length === 0) {
        if (selectedId && selectedId !== r.id) base = [selectedId];
        else base = [];
      }

      // Toggle dell'ID cliccato
      if (base.includes(r.id)) return base.filter((x) => x !== r.id);
      return [...base, r.id];
    });

    return; // non toccare selectedId
  }

  // click normale: selezione singola
  setGroupSel([]);
  onSelect(r.id);
}}

stroke={strokeColor}
strokeWidth={strokeW}
shadowOpacity={shadowOp}

shadowColor={isSel ? strokeSelected : 'transparent'}
shadowBlur={isSel ? 8 : 0}


  hitStrokeWidth={12}

  // 👇 NUOVO: cursore "move" quando è selezionata
  onMouseEnter={(e) => {
    if (!isSel) return;
    e.target.getStage()?.container()?.style.setProperty('cursor', 'move');
  }}
  onMouseLeave={(e) => {
    if (!isSel) return;
    e.target.getStage()?.container()?.style.removeProperty('cursor');
  }}

  // 👇 NUOVO: drag dell'intera falda cliccando sulla shape
onMouseDown={(e) => {
  if (!isSel) return;         // drag solo se questa falda è selezionata (singola o in gruppo)
  e.cancelBubble = true;

  const st = e.target.getStage(); if (!st) return;
  const ns = '.roof-move-poly';
  st.off(ns);

  onHandlesDragStart();

  // Set di ID da spostare: questa + eventuali altre selezionate
  const idsToMove = Array.from(new Set([r.id, ...groupSel]));

  // snapshot iniziale dei punti PER OGNI tetto selezionato
  groupStartPtsRef.current = {};
  for (const id of idsToMove) {
    const roof = layers.find((l) => l.id === id);
    if (roof) groupStartPtsRef.current[id] = roof.points.map((p) => ({ ...p }));
  }

  const pos = st.getPointerPosition(); if (!pos) return;
  moveStartPtrImgRef.current = toImg(pos.x, pos.y); // STAGE→IMG

  st.on('mousemove' + ns + ' touchmove' + ns, (evAny: any) => {
    const cur = st.getPointerPosition();
    if (!cur || !moveStartPtrImgRef.current) return;
    const curImg = toImg(cur.x, cur.y);

    let dx = curImg.x - moveStartPtrImgRef.current.x;
    let dy = curImg.y - moveStartPtrImgRef.current.y;

    // Shift = vincolo sull'asse dominante
    const shift = evAny?.evt?.shiftKey;
    if (shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    // aggiorna TUTTI i tetti selezionati
    for (const id of idsToMove) {
      const startPts = groupStartPtsRef.current[id];
      if (!startPts) continue;
      const moved = startPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      updateRoof(id, { points: moved });
    }
  });

  const end = () => {
    st.off(ns);
    moveStartPtrImgRef.current = null;
    groupStartPtsRef.current = {};
    onHandlesDragEnd();
  };
  st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
}}

/>

{/* ─── HANDLE PARALLELO LATO: shapeMode=normal ───────────────────────────── */}
{isSel && !multi && shapeMode  === 'normal' && edgeMeta(pts).map((e, k) => (
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

{/* ROTAZIONE (knob fuori, pivot al centro bbox) */}
{isSel && !multi && rotPivot && shapeMode !== 'trapezio' && rotHandlePos && (
  <>
    {/* stelo dal bordo top del bbox al knob */}
    {/* <KonvaLine
      points={[bb.cx, bb.minY - 6, bb.cx, rotHandlePos.y + HANDLE_SZ / 2]}
      stroke="#a78bfa" strokeWidth={1} listening={false}
    /> */}

    <KonvaGroup
      x={rotHandlePos.x}
      y={rotHandlePos.y}
      listening
      onMouseEnter={(e) => {
        e.target.getStage()?.container()?.style.setProperty('cursor','grab');
        const circle = (e.currentTarget as any).findOne('.rotKnob') as Konva.Circle;
        if (circle) { circle.fill('#7c3aed'); circle.stroke('#a78bfa'); circle.getLayer()?.batchDraw(); }
      }}
      onMouseLeave={(e) => {
        e.target.getStage()?.container()?.style.removeProperty('cursor');
        const circle = (e.currentTarget as any).findOne('.rotKnob') as Konva.Circle;
        if (circle) { circle.fill('#7c3aed'); circle.stroke('#a78bfa'); circle.getLayer()?.batchDraw(); }
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        const st = e.target.getStage(); if (!st) return;
        const ns = '.roof-rotate';
        st.off(ns);

        // snapshot iniziale
        startPtsRef.current   = r.points.map(p => ({ ...p }));
        startPivotRef.current = rotPivot;
        startAzimuthRef.current = r.azimuthDeg ?? 0;

        const pos = st.getPointerPosition(); if (!pos) return;
        const pImg = toImg(pos.x, pos.y);
        dragStartAngleRef.current = Math.atan2(pImg.y - rotPivot.y, pImg.x - rotPivot.x);
        dragStartDegRef.current   = rotDeg || 0;

        st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
          const cur = st.getPointerPosition();
          if (!cur || !startPtsRef.current || !startPivotRef.current) return;
          const qImg = toImg(cur.x, cur.y);
          const a = Math.atan2(qImg.y - startPivotRef.current.y, qImg.x - startPivotRef.current.x);
          let deltaDeg = (a - dragStartAngleRef.current) * (180 / Math.PI);

          // ALT = rotazione fine (più lenta/precisa)
          if (ev?.evt?.altKey) deltaDeg *= 0.2;

          const raw = dragStartDegRef.current + deltaDeg;
          const nextDeg = ev?.evt?.shiftKey ? Math.round(raw / 15) * 15 : raw;

          lastNextDegRef.current = nextDeg;
          setRoofRotDeg(nextDeg);

          const rotated = rotatePolygon(startPtsRef.current, startPivotRef.current, nextDeg);
          updateRoof(r.id, { points: rotated });
        });

        const end = () => {
          st.off(ns);
          const delta = lastNextDegRef.current - (dragStartDegRef.current || 0);
          const rawAz = startAzimuthRef.current + delta;
          const newAz = ((rawAz % 360) + 360) % 360;
          updateRoof(r.id, { azimuthDeg: newAz });
          setRoofRotDeg(0);
        };
        st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
      }}
    >
      {/* knob viola con icona bianca */}
      <KonvaCircle
        name="rotKnob"
        radius={HANDLE_SZ / 2}
        fill="#7c3aed"          // viola Canva-like
        stroke="#a78bfa"
        strokeWidth={1}
        shadowColor="rgba(0,0,0,0.25)"
        shadowBlur={4}
        shadowOpacity={0.9}
        listening
      />
{(() => {
  // scala proporzionale al diametro del knob (60% circa)
  const scale = (HANDLE_SZ * 0.60) / ROT_ICON.vbW / 18;

  return (
    <KonvaGroup
      name="rotIcon"
      x={-5.5}
      y={-5.5}
      scaleX={scale}
      scaleY={scale}
      offsetX={ROT_ICON.vbW / 2}
      offsetY={ROT_ICON.vbH / 2}
      listening={false}
    >
      {ROT_ICON.paths.map((d, i) => (
        <KonvaPath key={i} data={d} fill="#ffffff" />
      ))}
    </KonvaGroup>
  );
})()}


    </KonvaGroup>
  </>
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
