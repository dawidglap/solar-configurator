'use client';

import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { overlapsReservedRect } from '../../zones/utils'

type ModRect = { cx: number; cy: number; wPx: number; hPx: number; angleDeg: number };

type Props = {
  stageRef: React.RefObject<any>;
  toImgCoords: (x: number, y: number) => Pt;
  // la preview riceve sia il poligono del rettangolo (bordi modulo) sia i moduli calcolati
  onDraftChange?: (draft: { a: Pt; b: Pt; poly: Pt[]; rects: ModRect[] } | null) => void;
};

/* --------------------------- helpers geometrici --------------------------- */
const deg2rad = (d: number) => (d * Math.PI) / 180;

function centroid(pts: Pt[]) {
  let x = 0,
    y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(-theta),
    s = Math.sin(-theta);
  const dx = p.x - O.x,
    dy = p.y - O.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  return { x: p.x * c - p.y * s + O.x, y: p.x * s + p.y * c + O.y };
}

function normDeg(d: number) {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}
function angleDiffDeg(a: number, b: number) {
  let d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}
function longestEdgeAngleDeg(pts: Pt[] | null | undefined) {
  if (!pts || pts.length < 2) return 0;
  let best = 0,
    maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x,
      dy = pts[j].y - pts[i].y;
    const len2 = dx * dx + dy * dy;
    if (len2 > maxLen2) {
      maxLen2 = len2;
      best = Math.atan2(dy, dx);
    }
  }
  return (best * 180) / Math.PI;
}

/* --------------------------- griglia condivisa --------------------------- */
function gridBasics(angleDeg: number) {
  const s = usePlannerV2Store.getState();
  const roof = s.layers.find((l) => l.id === s.selectedId);
  const mpp = s.snapshot.mppImage;
  const panel = s.getSelectedPanel?.();
  const orientation = s.modules.orientation;
  if (!roof || !mpp || !panel) return null;

  const px = (m: number) => m / mpp;
  const panelW = px(orientation === 'portrait' ? panel.widthM : panel.heightM);
  const panelH = px(orientation === 'portrait' ? panel.heightM : panel.widthM);
  const gap = px(s.modules.spacingM);
  const cellW = panelW + gap;
  const cellH = panelH + gap;

  const theta = deg2rad(angleDeg);
  const O = centroid(roof.points);

  // BBox locale della falda, già "insettata" dal Randabstand
  const marginPx = px(s.modules.marginM);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of roof.points.map((p) => worldToLocal(p, O, theta))) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX += marginPx;
  minY += marginPx;
  maxX -= marginPx;
  maxY -= marginPx;

  // Binari dei CENTRI: partono dal bordo valido + metà pannello
  const startX = minX + panelW / 2;
  const startY = minY + panelH / 2;

  return {
    s,
    roof,
    panel,
    panelW,
    panelH,
    gap,
    cellW,
    cellH,
    theta,
    O,
    minX,
    minY,
    maxX,
    maxY,
    startX,
    startY,
    angleDeg,
  };
}

function snapRail(v: number, start: number, step: number) {
  return Math.round((v - start) / step) * step + start;
}

// Rettangolo A→B agganciato ai binari dei CENTRI, ma *espresso sui bordi modulo*
function rectPolyFromAB(aW: Pt, bW: Pt, basics: ReturnType<typeof gridBasics>) {
  if (!basics) return [aW, bW, bW, aW];
  const { panelW, panelH, cellW, cellH, theta, O, minX, minY, maxX, maxY, startX, startY } =
    basics;

  const aL = worldToLocal(aW, O, theta);
  const bL = worldToLocal(bW, O, theta);

  const minCX = minX + panelW / 2,
    maxCX = maxX - panelW / 2;
  const minCY = minY + panelH / 2,
    maxCY = maxY - panelH / 2;

  const aC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(aL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(aL.y, startY, cellH))),
  };
  const bC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(bL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(bL.y, startY, cellH))),
  };

  // il rettangolo verde rappresenta i BORDI modulo (quindi ± panel/2)
  const x0e = Math.max(minX, Math.min(aC.x, bC.x) - panelW / 2);
  const x1e = Math.min(maxX, Math.max(aC.x, bC.x) + panelW / 2);
  const y0e = Math.max(minY, Math.min(aC.y, bC.y) - panelH / 2);
  const y1e = Math.min(maxY, Math.max(aC.y, bC.y) + panelH / 2);

  const p1 = localToWorld({ x: x0e, y: y0e }, O, theta);
  const p2 = localToWorld({ x: x1e, y: y0e }, O, theta);
  const p3 = localToWorld({ x: x1e, y: y1e }, O, theta);
  const p4 = localToWorld({ x: x0e, y: y1e }, O, theta);
  return [p1, p2, p3, p4];
}

// Genera i moduli esattamente dentro al rettangolo (senza buchi e senza sforare)
function rectsForSelection(poly: Pt[], basics: ReturnType<typeof gridBasics>): ModRect[] {
  if (!basics) return [];
  const { roof, panelW, panelH, cellW, cellH, theta, O, minX, minY, maxX, maxY, startX, startY, angleDeg } =
    basics;

  const L = poly.map((p) => worldToLocal(p, O, theta));
  const x0 = Math.min(...L.map((p) => p.x));
  const x1 = Math.max(...L.map((p) => p.x));
  const y0 = Math.min(...L.map((p) => p.y));
  const y1 = Math.max(...L.map((p) => p.y));

  // indici ammessi dei binari (centri) all'interno del rettangolo “bordi modulo”
  const kMin = Math.ceil(((x0 + panelW / 2) - startX) / cellW);
  const kMax = Math.floor(((x1 - panelW / 2) - startX) / cellW);
  const rMin = Math.ceil(((y0 + panelH / 2) - startY) / cellH);
  const rMax = Math.floor(((y1 - panelH / 2) - startY) / cellH);

  const res: ModRect[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let k = kMin; k <= kMax; k++) {
      const cxL = startX + k * cellW;
      const cyL = startY + r * cellH;

      // clamp di sicurezza rispetto alla BBox insettata
      if (cxL < minX + panelW / 2 || cxL > maxX - panelW / 2) continue;
      if (cyL < minY + panelH / 2 || cyL > maxY - panelH / 2) continue;

      const Cw = localToWorld({ x: cxL, y: cyL }, O, theta);
      if (overlapsReservedRect({ cx: Cw.x, cy: Cw.y, w: panelW, h: panelH, angleDeg }, roof.id, 1))
       continue;

      res.push({ cx: Cw.x, cy: Cw.y, wPx: panelW, hPx: panelH, angleDeg });
    }
  }
  return res;
}

/* -------------------------------- component -------------------------------- */
export default function FillAreaController({ stageRef, toImgCoords, onDraftChange }: Props) {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);
  const addPanelsForRoof = usePlannerV2Store((s) => (s as any).addPanelsForRoof);

  const draftRef = useRef<{ a: Pt; b: Pt } | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const st = stageRef.current?.getStage?.();
    if (!st || step !== 'modules' || tool !== 'fill-area') return;

    const ns = '.fill-area';
    st.off(ns);

    const getMouseImg = () => {
      const pos = st.getPointerPosition();
      if (!pos) return null;
      return toImgCoords(pos.x, pos.y);
    };

    const getAngleDeg = () => {
      const roof = layers.find((l) => l.id === selectedId);
      if (!roof) return 0;
      const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;
      const polyDeg = longestEdgeAngleDeg(roof.points);
      const baseCanvasDeg = angleDiffDeg(eavesCanvasDeg, polyDeg) > 5 ? polyDeg : eavesCanvasDeg;
      return baseCanvasDeg + (modules.gridAngleDeg || 0);
    };

    const handleMouseMove = () => {
      if (!drawingRef.current || !draftRef.current) return;
      const p = getMouseImg();
      if (!p) return;

      const a = draftRef.current.a;
      const b = p;
      draftRef.current = { a, b };

      const basics = gridBasics(getAngleDeg());
      const poly = rectPolyFromAB(a, b, basics);
      const rects = rectsForSelection(poly, basics);
      onDraftChange?.({ a, b, poly, rects });
    };

    const handleClick = () => {
      const p = getMouseImg();
      if (!p) return;

      // primo click → start
      if (!drawingRef.current) {
        drawingRef.current = true;
        draftRef.current = { a: p, b: p };

        const basics = gridBasics(getAngleDeg());
        const poly = rectPolyFromAB(p, p, basics);
        const rects = rectsForSelection(poly, basics);
        onDraftChange?.({ a: p, b: p, poly, rects });
        return;
      }

      // secondo click → commit
      if (drawingRef.current && draftRef.current) {
        const a = draftRef.current.a;
        const b = draftRef.current.b;

        const basics = gridBasics(getAngleDeg());
        if (!basics) {
          drawingRef.current = false;
          draftRef.current = null;
          onDraftChange?.(null);
          return;
        }

        const poly = rectPolyFromAB(a, b, basics);
        const rects = rectsForSelection(poly, basics);

        const items: PanelInstance[] = rects.map((r) => ({
          id: nanoid(),
          roofId: basics.roof.id,
          cx: r.cx,
          cy: r.cy,
          wPx: r.wPx,
          hPx: r.hPx,
          angleDeg: r.angleDeg,
          orientation: basics.s.modules.orientation,
          panelId: basics.panel!.id,
          locked: false,
        }));

        addPanelsForRoof?.(basics.roof.id, items);

        // reset
        drawingRef.current = false;
        draftRef.current = null;
        onDraftChange?.(null);
      }
    };

    st.on('mousemove' + ns + ' touchmove' + ns, handleMouseMove);
    st.on('click' + ns + ' touchstart' + ns, handleClick);

    return () => {
      st.off(ns);
      drawingRef.current = false;
      draftRef.current = null;
      onDraftChange?.(null);
    };
  }, [stageRef, step, tool, layers, selectedId, modules.gridAngleDeg, toImgCoords, onDraftChange, addPanelsForRoof]);

  return null;
}
