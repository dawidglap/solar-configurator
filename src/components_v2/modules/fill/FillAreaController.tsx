'use client';

import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { computeGridInRect } from './computeGridInRect';

type Props = {
  stageRef: React.RefObject<any>;
  toImgCoords: (x: number, y: number) => Pt;
  onDraftChange?: (draft: { a: Pt; b: Pt } | null) => void;
};

/* ───────── helpers geometriche (rettangolo pannello, inside poly, distanze) ───────── */

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  // winding per poligoni convessi/concavi
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  const px = a.x + t * vx, py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}
function minDistToPolyEdges(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    d = Math.min(d, distPointToSeg(p, a, b));
  }
  return d;
}

function panelCorners(cx: number, cy: number, wPx: number, hPx: number, angleDeg: number): Pt[] {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  const hw = wPx / 2, hh = hPx / 2;
  const local: Pt[] = [
    { x: -hw, y: -hh },
    { x:  hw, y: -hh },
    { x:  hw, y:  hh },
    { x: -hw, y:  hh },
  ];
  return local.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

/* ────────────────────────────────────────────────────────────────────────────── */

export default function FillAreaController({ stageRef, toImgCoords, onDraftChange }: Props) {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);
  const snap = usePlannerV2Store((s) => s.snapshot);
  const getSelectedPanel = usePlannerV2Store((s) => s.getSelectedPanel);
  const addPanelsForRoof = usePlannerV2Store((s) => (s as any).addPanelsForRoof);
  const roofAlign = usePlannerV2Store((s) => s.roofAlign);
  const zonesAll = usePlannerV2Store((s) => (s as any).zones || []);

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

    const handleMouseMove = () => {
      if (!drawingRef.current || !draftRef.current) return;
      const p = getMouseImg();
      if (!p) return;
      draftRef.current = { a: draftRef.current.a, b: p };
      onDraftChange?.(draftRef.current);
    };

    const handleClick = () => {
      const p = getMouseImg();
      if (!p) return;

      // 1° click → start draft
      if (!drawingRef.current) {
        drawingRef.current = true;
        draftRef.current = { a: p, b: p };
        onDraftChange?.(draftRef.current);
        return;
      }

      // 2° click → commit
      if (drawingRef.current && draftRef.current) {
        const a = draftRef.current.a;
        const b = draftRef.current.b;

        const roof = layers.find((l) => l.id === selectedId);
        const panel = getSelectedPanel?.();
        const mpp = snap.mppImage;

        if (!roof || !panel || !mpp) {
          drawingRef.current = false;
          draftRef.current = null;
          onDraftChange?.(null);
          return;
        }

        // angolo totale: azimuth falda + gridAngle + rotazione UI temporanea
        const angleDeg =
          (roof.azimuthDeg ?? 0) +
          (modules.gridAngleDeg || 0) +
          (roofAlign?.rotDeg || 0);
        const t = (angleDeg * Math.PI) / 180;

        // assi ruotati come nella preview
        const ux = { x: Math.cos(t), y: Math.sin(t) };
        const uy = { x: -Math.sin(t), y: Math.cos(t) };

        // proiezione AB → w, h
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const w = vx * ux.x + vy * ux.y;
        const h = vx * uy.x + vy * uy.y;

        // rettangolo ruotato p1..p4
        const p1 = { x: a.x, y: a.y };
        const p2 = { x: a.x + w * ux.x, y: a.y + w * ux.y };
        const p3 = { x: p2.x + h * uy.x, y: p2.y + h * uy.y };
        const p4 = { x: a.x + h * uy.x, y: a.y + h * uy.y };
        const rectPoly = [p1, p2, p3, p4];

        // calcolo slot pannelli
        const slots = computeGridInRect({
          rectPoly,
          mpp,
          panel,
          orientation: modules.orientation,
          spacingM: modules.spacingM,
          angleDeg,
        });

        // filtro: margine tetto + zone riservate
        const roofPoly = roof.points;
        const marginPx = (modules.marginM || 0) / mpp;
        const zones = zonesAll.filter((z: any) => z.roofId === roof.id && z.type === 'riservata');

        const validSlots = slots.filter((slt) => {
          const corners = panelCorners(slt.cx, slt.cy, slt.wPx, slt.hPx, slt.angleDeg);

          // 1) tutti gli angoli dentro la falda
          if (!corners.every((c) => pointInPoly(c, roofPoly))) return false;

          // 2) distanza min da ogni bordo ≥ marginPx (per tutti gli angoli)
          if (marginPx > 0) {
            for (const c of corners) {
              if (minDistToPolyEdges(c, roofPoly) < marginPx) return false;
            }
          }

          // 3) niente intersezione con zone riservate (centro o angoli dentro)
          for (const z of zones) {
            const poly = z.points as Pt[];
            if (pointInPoly({ x: slt.cx, y: slt.cy }, poly)) return false;
            if (corners.some((c) => pointInPoly(c, poly))) return false;
          }

          return true;
        });

        // materializza PanelInstance (con id)
        const items: PanelInstance[] = validSlots.map((slt) => ({
          id: nanoid(),
          roofId: roof.id,
          cx: slt.cx,
          cy: slt.cy,
          wPx: slt.wPx,
          hPx: slt.hPx,
          angleDeg: slt.angleDeg,
          orientation: modules.orientation,
          panelId: panel.id,
          locked: false,
        }));

        // batch insert
        addPanelsForRoof?.(roof.id, items);

        // reset draft
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
  }, [
    stageRef,
    step,
    tool,
    layers,
    selectedId,
    modules,
    snap.mppImage,
    roofAlign?.rotDeg,
    toImgCoords,
    onDraftChange,
    addPanelsForRoof,
    getSelectedPanel,
    zonesAll,
  ]);

  return null;
}
