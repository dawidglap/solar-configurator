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
import { history as plannerHistory } from '../state/history';
import Konva from 'konva';

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

function edgeMeta(
  pts: Pt[],
  opts: { minLenPx?: number; nearVertexPx?: number } = {}
) {
  const MIN_LEN = opts.minLenPx ?? 12;         // ignora segmenti troppo corti
  const NEAR_V  = opts.nearVertexPx ?? 10;     // distanza sotto cui "è un vertice"

  const out: {
    i: number; j: number;
    mx: number; my: number;
    nx: number; ny: number;
    angleDeg: number;
    cursor: 'ns-resize' | 'ew-resize';
  }[] = [];

  const dist2 = (ax:number, ay:number, bx:number, by:number) => {
    const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy;
  };

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pts[i], b = pts[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);

    if (len < MIN_LEN) continue;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    if (Math.sqrt(dist2(mx, my, a.x, a.y)) < NEAR_V) continue;
    if (Math.sqrt(dist2(mx, my, b.x, b.y)) < NEAR_V) continue;

    const nx = -dy / len;
    const ny =  dx / len;

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const cursor = Math.abs(dx) >= Math.abs(dy) ? 'ns-resize' : 'ew-resize';

    const tooClose = out.some(h => dist2(h.mx, h.my, mx, my) < (NEAR_V*NEAR_V));
    if (!tooClose) {
      out.push({ i, j, mx, my, nx, ny, angleDeg, cursor });
    }
  }
  return out;
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

// === SNAP UTILS ===
function stagePxToImgPx(toImg: (x:number,y:number)=>{x:number;y:number}, n=1) {
  const a = toImg(0,0);
  const bx = toImg(n,0);
  const by = toImg(0,n);
  const sx = Math.hypot(bx.x - a.x, bx.y - a.y);
  const sy = Math.hypot(by.x - a.x, by.y - a.y);
  return Math.max(sx, sy); // fattore "px stage -> px immagine"
}
type SnapTarget = { roofId: string; index: number; x: number; y: number };

// ─────────────────────────────────────────────────────────────────────────────
// ANGLES AT VERTICES (per mostrare 30/45/60/90)
// ─────────────────────────────────────────────────────────────────────────────

const DEG_REFS = [30, 45, 60, 90] as const;
const TOL_HINT = 1.5;  // ±1.5° → mostra badge blu
const TOL_OK   = 0.25; // ±0.25° → badge verde

function clamp(n:number, a:number, b:number){ return Math.max(a, Math.min(b, n)); }
function len(v:Pt){ return Math.hypot(v.x, v.y); }
function norm(v:Pt){ const L = len(v) || 1; return { x: v.x / L, y: v.y / L }; }

function angleBetweenDeg(u:Pt, v:Pt) {
  const L1 = len(u), L2 = len(v);
  if (L1 < 1e-6 || L2 < 1e-6) return 0;
  const dot = u.x * v.x + u.y * v.y;
  const cos = clamp(dot / (L1 * L2), -1, 1);
  return Math.acos(cos) * (180 / Math.PI); // 0..180
}

function nearestRef(deg: number) {
  let best: number = DEG_REFS[0]; // ← allarga a number
  let bd = Infinity;
  for (const r of DEG_REFS) {
    const d = Math.abs(deg - r);
    if (d < bd) { bd = d; best = r; }
  }
  return { ref: best, diff: bd };
}


/** Restituisce per ogni vertice: { x, y, deg, ref, diff } */
function vertexAngles(pts: Pt[]) {
  const out: Array<{ x:number; y:number; deg:number; ref:number; diff:number; bis:Pt }> = [];
  const n = pts.length;
  if (n < 3) return out;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };

    const deg = angleBetweenDeg(v1, v2); // interno 0..180

    // bisettrice (verso l'interno): somma dei vettori normalizzati
    const u1 = norm(v1), u2 = norm(v2);
    let bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const L = len(bis);
    if (L < 1e-6) bis = { x: 0, y: 0 }; else bis = { x: bis.x / L, y: bis.y / L };

    const { ref, diff } = nearestRef(deg);
    out.push({ x: curr.x, y: curr.y, deg, ref, diff, bis });
  }
  return out;
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
  const step = usePlannerV2Store(s => s.step);
  const roofsLocked = step === 'modules';
    const tool = usePlannerV2Store(s => s.tool);
  const setTool = usePlannerV2Store(s => s.setTool);




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

  const [groupSel, setGroupSel] = useState<string[]>([]);

  // modalità "Canva": drag di gruppo quando nessuna falda è selezionata
  
  const [hoverAll, setHoverAll] = useState(false);


  const hasPrimarySelection = useMemo(
    () => !!selectedId && layers.some(l => l.id === selectedId),
    [selectedId, layers]
  );

  const isCanvaGroupDrag = useMemo(
    () => tool === 'select' && !hasPrimarySelection && groupSel.length === 0,
    [tool, hasPrimarySelection, groupSel.length]
  );

  // Snapshot punti per drag di gruppo (UNA sola dichiarazione)
  const groupStartPtsRef = useRef<Record<string, Pt[]>>({});

  // --- Keyboard: ESC / DELETE
  useEffect(() => {
    const isEditing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if ((el as any).isContentEditable) return true;

      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const aTag = active.tagName?.toLowerCase();
        if (aTag === 'input' || aTag === 'textarea') return true;
        if ((active as any).isContentEditable) return true;
      }
      if (
        el.closest?.(
          'input, textarea, [contenteditable="true"], ' +
          '.osm-anchor, .osm-dropdown, .react-select__control, .pac-container, ' +
          '[role="textbox"], [role="combobox"]'
        )
      ) return true;

      let p: HTMLElement | null = el.parentElement;
      while (p) {
        const pTag = p.tagName?.toLowerCase();
        if (pTag === 'input' || pTag === 'textarea') return true;
        if ((p as any).isContentEditable) return true;
        p = p.parentElement;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditing(e.target)) return;

      if (e.key === 'Escape') {
        setGroupSel([]);
        onSelect(undefined);
      }

  if (e.key === 'Delete' || e.key === 'Backspace') {
  // ⛔️ in modules non eliminiamo falde
  if (step === 'modules') return;

  const ids = groupSel.length ? groupSel : (selectedId ? [selectedId] : []);
  if (!ids.length) return;
  e.preventDefault();

  plannerHistory.push('delete roof');
  ids.forEach((id) => removeRoof(id));
  setGroupSel([]);
  onSelect(undefined);
}

    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groupSel, selectedId, removeRoof, onSelect]);

  // --- Pulisci groupSel se i layers cambiano
  useEffect(() => {
    const existing = new Set(layers.map(l => l.id));
    setGroupSel(prev => prev.filter(id => existing.has(id)));
  }, [layers]);

// icona e knob
const ROT_ICON = useMemo(() => iconToPaths(FaRotate), []);

// converte pixel schermo -> pixel immagine (varia con lo zoom)
const toImgPx = useMemo(
  () => (pxScreen: number) => stagePxToImgPx(toImg, pxScreen),
  [toImg]
);

// valori in PX SCHERMO
const KNOB_OFFSET_S = 8;   // distanza dal bordo
const HANDLE_SIZE_S = 28;   // diametro del cerchio

// conversione in PX IMMAGINE
const ROT_KNOB_OFFSET = toImgPx(KNOB_OFFSET_S);
const HANDLE_SZ       = toImgPx(HANDLE_SIZE_S);



  // SNAP CONFIG
  const SNAP_RADIUS_STAGE = 6;
  const snapRadiusImg = useMemo(() => SNAP_RADIUS_STAGE * stagePxToImgPx(toImg, 1), [toImg]);

  // Candidati snap
  const getSnapTargets = useMemo(() => {
    const all: SnapTarget[] = [];
    for (const L of layers) {
      L.points.forEach((p, i) => { all.push({ roofId: L.id, index: i, x: p.x, y: p.y }); });
    }
    return () => all;
  }, [layers]);

  // subito prima del return
  const topHandles: React.ReactElement[] = [];

  return (
    <>
      {/* Clic sullo sfondo: deseleziona */}
  <KonvaRect
  x={0}
  y={0}
  width={imgW}
  height={imgH}
  fill="rgba(0,0,0,0)"
  listening
  onClick={() => {
    // solo quando siamo GIÀ in modalità selezione
    if (tool !== 'select') return;

    // niente più cambio tool (è già select)
    setGroupSel([]);
    onSelect(undefined);
    setHoverAll(false);
  }}
/>


      {layers.map(r => {
        const sel = r.id === selectedId;

        // pts correnti
        const pts = r.points;
        const flat = toFlat(pts);
        const c = centroid(pts);
        const label = showAreaLabels ? areaLabel(pts) : null;

        const isSel = sel || groupSel.includes(r.id);
        const highlightAll = hoverAll && isCanvaGroupDrag;

        const multi  = groupSel.length > 0;
        const inGroupOnly = !sel && groupSel.includes(r.id);
        const strokeColor = highlightAll
          ? '#59AC77'
          : sel
            ? strokeSelected
            : inGroupOnly
              ? '#59AC77'
              : stroke;

        const strokeW  = highlightAll
          ? Math.max(strokeWidthSelected, 1)
          : sel || inGroupOnly
            ? strokeWidthSelected
            : strokeWidthNormal;

        const shadowOp = (sel || inGroupOnly || highlightAll) ? 0.6 : 0;

        const bb = bbox(pts);

        // pivot di rotazione = centro bbox (se selezionato)
        const rotPivot = isSel ? (pivotPx ?? { x: bb.cx, y: bb.cy }) : undefined;
        const rotHandlePos = (isSel && rotPivot)
          ? { x: bb.cx, y: bb.minY - ROT_KNOB_OFFSET }
          : null;

        // maniglie lato (solo selezione singola + shape normale)
        if (!roofsLocked && isSel && !multi && shapeMode === 'normal') {
          edgeMeta(pts, { minLenPx: 12, nearVertexPx: 10 }).forEach((e, k) => {
            topHandles.push(
              <KonvaGroup
                key={`edge-h-${r.id}-${k}`}
                x={e.mx}
                y={e.my}
                onMouseEnter={(ev) => {
                  ev.target.getStage()?.container()?.style.setProperty('cursor', e.cursor);
                }}
                onMouseLeave={(ev) => {
                  ev.target.getStage()?.container()?.style.removeProperty('cursor');
                }}
              >
                <KonvaGroup rotation={e.angleDeg}>
                  <KonvaRect
                    x={-6} y={-1} width={12} height={3} cornerRadius={3.5}
                    fill="#ffffff" stroke="#fff" strokeWidth={0.5}
                    shadowColor="rgba(0,0,0,0.25)" shadowBlur={3} shadowOpacity={0.9}
                    onMouseEnter={(ev) => {
                      const rect = ev.target as unknown as Konva.Rect;
                      rect.fill('#2269c5'); rect.stroke('#164aa3'); rect.getLayer()?.batchDraw();
                    }}
                    onMouseLeave={(ev) => {
                      const rect = ev.target as unknown as Konva.Rect;
                      rect.fill('#ffffff'); rect.stroke('#fff'); rect.getLayer()?.batchDraw();
                    }}
                    onMouseDown={(ev) => {
                      ev.cancelBubble = true;
                      const st = ev.target.getStage(); if (!st) return;
                      plannerHistory.push('move roof');
                      const ns = `.roof-edge-${k}`;
                      st.off(ns);

                      onHandlesDragStart();

                      // snapshot iniziale
                      moveStartPtsRef.current = r.points.map(p => ({ ...p }));
                      const pos = st.getPointerPosition(); if (!pos) return;
                      moveStartPtrImgRef.current = toImg(pos.x, pos.y);

                      st.on('mousemove' + ns + ' touchmove' + ns, () => {
                        const cur = st.getPointerPosition();
                        if (!cur || !moveStartPtsRef.current || !moveStartPtrImgRef.current) return;
                        const curImg = toImg(cur.x, cur.y);

                        const dx = curImg.x - moveStartPtrImgRef.current.x;
                        const dy = curImg.y - moveStartPtrImgRef.current.y;

                        const t = dx * e.nx + dy * e.ny;
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
                </KonvaGroup>
              </KonvaGroup>
            );
          });
        }

        return (
          <KonvaGroup key={r.id}>
            <KonvaLine
              points={flat}
              closed
              lineJoin="round"
              lineCap="round"
              fill={fill}
             onClick={(e) => {
  // in modalità modules: NIENTE multi-select, ma devo comunque poter selezionare la falda
  if (roofsLocked) {
    setGroupSel([]);
    onSelect(r.id);
    return;
  }

  const withShift = !!(e.evt && e.evt.shiftKey);
  if (withShift) {
    setGroupSel((prev) => {
      let base = prev;
      if (prev.length === 0) {
        if (selectedId && selectedId !== r.id) base = [selectedId];
        else base = [];
      }
      if (base.includes(r.id)) return base.filter((x) => x !== r.id);
      return [...base, r.id];
    });
    return;
  }
  setGroupSel([]);
  onSelect(r.id);
}}

              stroke={strokeColor}
              strokeWidth={strokeW}
              shadowOpacity={shadowOp}
              shadowColor={isSel ? strokeSelected : 'transparent'}
              shadowBlur={isSel || highlightAll ? 8 : 0}
              hitStrokeWidth={12}
              onMouseEnter={(e) => {
                  if (roofsLocked) return; 
                const c = e.target.getStage()?.container();
                if (isCanvaGroupDrag) {
                  setHoverAll(true);
                  c?.style.setProperty('cursor', 'move');
                } else if (isSel) {
                  c?.style.setProperty('cursor', 'move');
                }
              }}
              onMouseLeave={(e) => {
                const c = e.target.getStage()?.container();
                if (isCanvaGroupDrag) setHoverAll(false);
                if (isSel || isCanvaGroupDrag) c?.style.removeProperty('cursor');
              }}
              onMouseDown={(e) => {
                 if (roofsLocked) {                          // ⬅️ blocca ogni tipo di drag in modules
    e.cancelBubble = true;
    return;
  }
                e.cancelBubble = true;
                const st = e.target.getStage(); if (!st) return;
                plannerHistory.push('offset edge');

                const forceAll = !!(e?.evt?.altKey || e?.evt?.metaKey || e?.evt?.ctrlKey);

                if (isCanvaGroupDrag || forceAll) {
                  const ns = '.move-all-canva';
                  st.off(ns);
                  onHandlesDragStart();

                  groupStartPtsRef.current = {};
                  const idsToMove = layers.map(l => l.id);
                  for (const l of layers) groupStartPtsRef.current[l.id] = l.points.map(p => ({ ...p }));

                  const p0 = st.getPointerPosition(); if (!p0) return;
                  moveStartPtrImgRef.current = toImg(p0.x, p0.y);

                  st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
                    const pos = st.getPointerPosition();
                    if (!pos || !moveStartPtrImgRef.current) return;
                    const cur = toImg(pos.x, pos.y);
                    let dx = cur.x - moveStartPtrImgRef.current.x;
                    let dy = cur.y - moveStartPtrImgRef.current.y;

                    if (ev?.evt?.shiftKey) {
                      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
                      else dx = 0;
                    }

                    const update = usePlannerV2Store.getState().updateRoof;
                    idsToMove.forEach(id => {
                      const startPts = groupStartPtsRef.current[id];
                      if (!startPts) return;
                      const moved = startPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
                      update(id, { points: moved });
                    });
                  });

                  const end = () => {
                    st.off(ns);
                    moveStartPtrImgRef.current = null;
                    groupStartPtsRef.current = {};
                    setHoverAll(false);
                    onHandlesDragEnd();
                  };
                  st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
                  return;
                }

                // NORMALE: muovi solo selezionata o multi-selezione esistente
                if (!isSel) return;
                const ns = '.roof-move-poly';
                st.off(ns);
                onHandlesDragStart();

                const idsToMove = Array.from(new Set([r.id, ...groupSel]));
                groupStartPtsRef.current = {};
                idsToMove.forEach(id => {
                  const roof = layers.find(l => l.id === id);
                  if (roof) groupStartPtsRef.current[id] = roof.points.map(p => ({ ...p }));
                });

                const p0 = st.getPointerPosition(); if (!p0) return;
                moveStartPtrImgRef.current = toImg(p0.x, p0.y);

                st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
                  const pos = st.getPointerPosition();
                  if (!pos || !moveStartPtrImgRef.current) return;
                  const cur = toImg(pos.x, pos.y);
                  let dx = cur.x - moveStartPtrImgRef.current.x;
                  let dy = cur.y - moveStartPtrImgRef.current.y;

                  if (ev?.evt?.shiftKey) {
                    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
                    else dx = 0;
                  }

                  idsToMove.forEach(id => {
                    const startPts = groupStartPtsRef.current[id];
                    if (!startPts) return;
                    const moved = startPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
                    updateRoof(id, { points: moved });
                  });
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

            {/* ─── ANGOLI NEI VERTICI: mostra 30/45/60/90 con tolleranza ─── */}
            {isSel && (() => {
              // DOPO — badge molto più piccoli (~40% delle dimensioni attuali)
const ANGLE_LABEL_OFFSET = 8;     // prima 16 → meno invadente
const BADGE_W = 8;                // prima 28
const BADGE_H = 4;                 // prima 18
const BADGE_RX = 4;                // corner radius
const FONT_SIZE = 3;               // prima 11
const SHADOW_BLUR = 2;             // prima 3
const FILL_ALPHA = 0.55;           // prima 0.92

const corners = vertexAngles(pts);



              return (
                <>
                  {corners.map((k, idx) => {
                    const near = k.diff <= TOL_HINT;
                    if (!near) return null;

                    const perfect = k.diff <= TOL_OK;
                    const pos = { x: k.x + k.bis.x * ANGLE_LABEL_OFFSET, y: k.y + k.bis.y * ANGLE_LABEL_OFFSET };
                    const txt = `${k.ref}°`;

               return (
  <KonvaGroup key={`corner-${idx}`} x={pos.x} y={pos.y} listening={false} opacity={0.9}>
    <KonvaRect
      x={-BADGE_W/2} y={-BADGE_H/2} width={BADGE_W} height={BADGE_H} cornerRadius={BADGE_RX}
      fill={perfect ? `rgba(0,0,0,${FILL_ALPHA})` : `rgba(0,0,0,${FILL_ALPHA})`}
      shadowColor="rgba(0,0,0,0.25)" shadowBlur={SHADOW_BLUR} shadowOpacity={0.6}
    />
    <KonvaText
      x={-BADGE_W/2} y={-BADGE_H/2} width={BADGE_W} height={BADGE_H}
      align="center" verticalAlign="middle"
      text={`${k.ref}°`} fontSize={FONT_SIZE} fontStyle="500" fill="#fff"
    />
  </KonvaGroup>
);

                  })}
                </>
              );
            })()}

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
            {!roofsLocked && isSel && !multi && rotPivot && shapeMode !== 'trapezio' && rotHandlePos && (
              <>
               <KonvaGroup
  x={rotHandlePos.x}
  y={rotHandlePos.y}
  listening
  onMouseEnter={(e) => {
    e.target.getStage()?.container()?.style.setProperty('cursor','grab');
  }}
  onMouseLeave={(e) => {
    e.target.getStage()?.container()?.style.removeProperty('cursor');
  }}
  onMouseDown={(e) => {
    e.cancelBubble = true;
    const st = e.target.getStage(); if (!st) return;
    const ns = '.roof-rotate';
    st.off(ns);

    // snapshot iniziale (usa le refs già dichiarate nel file)
    startPtsRef.current       = r.points.map(p => ({ ...p }));
    startPivotRef.current     = rotPivot!;
    startAzimuthRef.current   = r.azimuthDeg ?? 0;

    const pos = st.getPointerPosition(); if (!pos) return;
    const pImg = toImg(pos.x, pos.y);
    dragStartAngleRef.current = Math.atan2(pImg.y - rotPivot!.y, pImg.x - rotPivot!.x);
    dragStartDegRef.current   = rotDeg || 0;

    st.on('mousemove' + ns + ' touchmove' + ns, (ev: any) => {
      const cur = st.getPointerPosition();
      if (!cur || !startPtsRef.current || !startPivotRef.current) return;

      const qImg = toImg(cur.x, cur.y);
      const a = Math.atan2(qImg.y - startPivotRef.current.y, qImg.x - startPivotRef.current.x);

      let deltaDeg = (a - dragStartAngleRef.current) * (180 / Math.PI);
      if (ev?.evt?.altKey) deltaDeg *= 0.2;          // rotazione fine

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
  {/* Cerchio bianco contenitore (dimensione costante visivamente grazie a HANDLE_SZ calcolato con toImgPx) */}
  <KonvaCircle
    name="rotKnob"
    radius={HANDLE_SZ / 2}
    fill="#ffffff"
    stroke="#565656"
    strokeWidth={0.5}
    shadowColor="rgba(0,0,0,0.25)"
    shadowBlur={4}
    shadowOpacity={0.9}
    listening
  />

{(() => {
  // scala di "fit": l'icona occupa ~70% del diametro del cerchio
  const FIT = 0.03; // prova 0.68–0.78 per ritocchi
  const sx = (HANDLE_SZ * FIT) / ROT_ICON.vbW;
  const sy = (HANDLE_SZ * FIT) / ROT_ICON.vbH;
  const scale = Math.min(sx, sy);

  return (
    <KonvaGroup
      name="rotIcon"
      // niente x/y magici: centrata sul cerchio
      scaleX={scale}
      scaleY={scale}
      offsetX={250}
      offsetY={250}
      listening={false}
    >
      {ROT_ICON.paths.map((d, i) => (
        <KonvaPath key={i} data={d} fill="#545454" strokeEnabled={false} />
      ))}
    </KonvaGroup>
  );
})()}

</KonvaGroup>

              </>
            )}

            {/* Maniglie TRAPEZIO */}
            {!roofsLocked && sel && shapeMode === 'trapezio' && (
              <RoofHandlesKonva
                roofId={r.id}
                points={r.points}
                imgW={imgW}
                imgH={imgH}
                toImg={toImg}
                getSnapTargets={getSnapTargets}
                snapRadiusImg={snapRadiusImg}
                onDragStart={onHandlesDragStart}
                onDragEnd={onHandlesDragEnd}
                onChange={(next) => updateRoof(r.id, { points: next })}
              />
            )}
          </KonvaGroup>
        );
      })}
      {/* maniglie disegnate DOPO tutte le falde → sempre sopra */}
      {topHandles}
    </>
  );
}
