'use client';

import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { computeAutoLayoutRects } from '../layout';
import { isInReservedZone } from '../../zones/utils';

type Props = {
  stageRef: React.RefObject<any>;
  toImgCoords: (x: number, y: number) => Pt;
  // 👇 ora passiamo anche la poly già RUOTATA
  onDraftChange?: (draft: { a: Pt; b: Pt; poly: Pt[] } | null) => void;
};

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[(i + 1) % poly.length].x, yj = poly[(i + 1) % poly.length].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// rettangolo ruotato A→B proiettato sugli assi dell’angolo
function rectPolyFromAB(a: Pt, b: Pt, angleDeg: number): Pt[] {
  const t = (angleDeg * Math.PI) / 180;
  const ux = { x: Math.cos(t),  y: Math.sin(t)  };
  const uy = { x: -Math.sin(t), y: Math.cos(t) };

  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const w = vx * ux.x + vy * ux.y;
  const h = vx * uy.x + vy * uy.y;

  const p1 = { x: a.x,           y: a.y };
  const p2 = { x: a.x + w*ux.x,  y: a.y + w*ux.y };
  const p3 = { x: p2.x + h*uy.x, y: p2.y + h*uy.y };
  const p4 = { x: a.x + h*uy.x,  y: a.y + h*uy.y };
  return [p1, p2, p3, p4];
}

function normDeg(d: number) { const x = d % 360; return x < 0 ? x + 360 : x; }
function angleDiffDeg(a: number, b: number) {
  let d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}
function longestEdgeAngleDeg(pts: Pt[] | null | undefined) {
  if (!pts || pts.length < 2) return 0;
  let best = 0, maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len2 = dx*dx + dy*dy;
    if (len2 > maxLen2) { maxLen2 = len2; best = Math.atan2(dy, dx) * 180/Math.PI; }
  }
  return best;
}


export default function FillAreaController({ stageRef, toImgCoords, onDraftChange }: Props) {
  const step             = usePlannerV2Store((s) => s.step);
  const tool             = usePlannerV2Store((s) => s.tool);
  const layers           = usePlannerV2Store((s) => s.layers);
  const selectedId       = usePlannerV2Store((s) => s.selectedId);
  const modules          = usePlannerV2Store((s) => s.modules);
  const snap             = usePlannerV2Store((s) => s.snapshot);
  const getSelectedPanel = usePlannerV2Store((s) => s.getSelectedPanel);
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

const currentAngleDeg = () => {
  const roof = layers.find((l) => l.id === selectedId);
  if (!roof) return 0;

  // 1) azimut → canvas
  const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;

  // 2) edge più lungo del poligono (in canvas)
  const polyDeg = longestEdgeAngleDeg(roof.points);

  // 3) soglia 5° tra gronda e edge lungo
  const baseCanvasDeg =
    angleDiffDeg(eavesCanvasDeg, polyDeg) > 5 ? polyDeg : eavesCanvasDeg;

  // 4) offset utente della griglia
  return baseCanvasDeg + (modules.gridAngleDeg || 0);
};


    const handleMouseMove = () => {
      if (!drawingRef.current || !draftRef.current) return;
      const p = getMouseImg();
      if (!p) return;
      const a = draftRef.current.a;
      const b = p;
      draftRef.current = { a, b };
      // 🔁 preview ruotata come l’auto-layout
      const poly = rectPolyFromAB(a, b, currentAngleDeg());
      onDraftChange?.({ a, b, poly });
    };

    const handleClick = () => {
      const p = getMouseImg();
      if (!p) return;

      // 1° click → start draft
      if (!drawingRef.current) {
        drawingRef.current = true;
        draftRef.current = { a: p, b: p };
        const poly = rectPolyFromAB(p, p, currentAngleDeg());
        onDraftChange?.({ a: p, b: p, poly });
        return;
      }

      // 2° click → commit
      if (drawingRef.current && draftRef.current) {
        const a = draftRef.current.a;
        const b = draftRef.current.b;

        const roof   = layers.find((l) => l.id === selectedId);
        const panel  = getSelectedPanel?.();
        const mpp    = snap.mppImage;

        if (!roof || !panel || !mpp) {
          drawingRef.current = false;
          draftRef.current = null;
          onDraftChange?.(null);
          return;
        }

        const angleDeg = currentAngleDeg();
        const rectPoly = rectPolyFromAB(a, b, angleDeg);

        // rettangoli “ufficiali” come preview/auto-layout
        const rectsAll = computeAutoLayoutRects({
          polygon: roof.points,
          mppImage: mpp,
          azimuthDeg: angleDeg,
          orientation: modules.orientation,
          panelSizeM: { w: panel.widthM, h: panel.heightM },
          spacingM: modules.spacingM,
          marginM:  modules.marginM,
          phaseX:   (modules as any).gridPhaseX || 0,
          phaseY:   (modules as any).gridPhaseY || 0,
          anchorX: ((modules as any).gridAnchorX as any) || 'start',
          anchorY: ((modules as any).gridAnchorY as any) || 'start',
          coverageRatio: (modules as any).coverageRatio ?? 1,
        });

        // centra dentro al rettangolo disegnato + escludi zone riservate
        const selected = rectsAll.filter(r => pointInPoly({ x: r.cx, y: r.cy }, rectPoly));
        const safe = selected.filter(r => !isInReservedZone({ x: r.cx, y: r.cy }, roof.id));

        const items: PanelInstance[] = safe.map((r) => ({
          id: nanoid(),
          roofId: roof.id,
          cx: r.cx,
          cy: r.cy,
          wPx: r.wPx,
          hPx: r.hPx,
          angleDeg: r.angleDeg, // 💡 uguale alla preview/auto-layout
          orientation: modules.orientation,
          panelId: panel.id,
          locked: false,
        }));

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
    toImgCoords,
    onDraftChange,
    addPanelsForRoof,
    getSelectedPanel,
  ]);

  return null;
}
