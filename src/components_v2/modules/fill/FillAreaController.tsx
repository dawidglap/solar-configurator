'use client';

import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt, PanelInstance } from '@/types/planner';
import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import { resolveSurfacePlanning } from '@/lib/planning-core/advanced';
import { history } from '@/components_v2/state/history';
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  resolveRoofModuleMode,
  resolveStandardTiltInput,
  setAdvancedQuantityMode,
} from '../advanced/advancedPlanningApplication';
import { selectAdditiveFillPanels } from './additiveFill';

import { isPrimaryPointerButton } from '../../canvas/interactionPolicy';


type ModRect = { cx: number; cy: number; wPx: number; hPx: number; angleDeg: number };

type Props = {
  stageRef: React.RefObject<Konva.Stage | null>;
  toImgCoords: (x: number, y: number) => Pt;
  onDraftChange?: (draft: { a: Pt; b: Pt; poly: Pt[]; rects: ModRect[] } | null) => void;
  cancelVersion?: number;
};

/* --------------------------- helpers geometrici --------------------------- */
const deg2rad = (d: number) => (d * Math.PI) / 180;

function centroid(pts: Pt[]) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const dx = p.x - O.x, dy = p.y - O.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: p.x * c - p.y * s + O.x, y: p.x * s + p.y * c + O.y };
}
function normDeg(d: number) { const x = d % 360; return x < 0 ? x + 360 : x; }
function angleDiffDeg(a: number, b: number) {
  const d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}
function longestEdgeAngleDeg(pts: Pt[] | null | undefined) {
  if (!pts || pts.length < 2) return 0;
  let best = 0, maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len2 = dx * dx + dy * dy;
    if (len2 > maxLen2) { maxLen2 = len2; best = Math.atan2(dy, dx); }
  }
  return (best * 180) / Math.PI;
}

function axisAlignedRect(a: Pt, b: Pt): Pt[] {
  return [
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
  ];
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

  // dimensioni modulo in px (portrait/landscape) + gap in px
  let panelW = px(orientation === 'portrait' ? panel.widthM : panel.heightM);
  let panelH = px(orientation === 'portrait' ? panel.heightM : panel.widthM);
  let gapX   = px(s.modules.spacingXM ?? s.modules.spacingM);
  let gapY   = px(s.modules.spacingYM ?? s.modules.spacingM);

  // (opzionale) micro-snap per stabilità numerica
  const snap = (v: number) => Math.round(v * 10) / 10; // 0.1px
  panelW = snap(panelW);
  panelH = snap(panelH);
  gapX   = snap(gapX);
  gapY   = snap(gapY);

  const cellW = panelW + gapX;
  const cellH = panelH + gapY;

  const theta = deg2rad(angleDeg);
  const O = centroid(roof.points);

  // bounding in locale della falda, insettata dal Randabstand
  const marginPx = px(resolveRoofEdgeMarginM(roof, s.modules.marginM));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of roof.points.map((p) => worldToLocal(p, O, theta))) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX += marginPx; minY += marginPx;
  maxX -= marginPx; maxY -= marginPx;

  // rail dei CENTRI: bordo valido + metà pannello
  const startX = minX + panelW / 2;
  const startY = minY + panelH / 2;

  return {
    s, roof, panel,
    panelW, panelH, gapX, gapY, cellW, cellH,
    theta, O, minX, minY, maxX, maxY, startX, startY,
    angleDeg,
  };
}

function snapRail(v: number, start: number, step: number) {
  return Math.round((v - start) / step) * step + start;
}

// Rettangolo A→B, agganciato ai rail dei **centri**, ma espresso sui **bordi modulo**
function rectPolyFromAB(aW: Pt, bW: Pt, basics: ReturnType<typeof gridBasics>) {
  if (!basics) return [aW, bW, bW, aW];
  const { panelW, panelH, cellW, cellH, theta, O, minX, minY, maxX, maxY, startX, startY } = basics;

  const aL = worldToLocal(aW, O, theta);
  const bL = worldToLocal(bW, O, theta);

  const minCX = minX + panelW / 2, maxCX = maxX - panelW / 2;
  const minCY = minY + panelH / 2, maxCY = maxY - panelH / 2;

  const aC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(aL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(aL.y, startY, cellH))),
  };
  const bC = {
    x: Math.min(maxCX, Math.max(minCX, snapRail(bL.x, startX, cellW))),
    y: Math.min(maxCY, Math.max(minCY, snapRail(bL.y, startY, cellH))),
  };

  // rettangolo in coordinate "bordi modulo"
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

/* -------------------------------- component -------------------------------- */
export default function FillAreaController({ stageRef, toImgCoords, onDraftChange, cancelVersion = 0 }: Props) {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);
  const appendPanelsToRoof = usePlannerV2Store((s) => s.appendPanelsToRoof);

  const draftRef = useRef<{ a: Pt; b: Pt } | null>(null);
  const drawingRef = useRef(false);
  const candidatesRef = useRef<PanelInstance[]>([]);

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

    const buildCandidates = (): { mode: ReturnType<typeof resolveRoofModuleMode>; panels: PanelInstance[] } => {
      const state = usePlannerV2Store.getState();
      const roof = state.layers.find((candidate) => candidate.id === state.selectedId);
      const mppImage = state.snapshot.mppImage;
      const panel = state.getSelectedPanel();
      const mode = resolveRoofModuleMode({ roof, roofId: roof?.id, panels: state.panels });
      if (!roof || !mppImage || !panel || !mode) return { mode, panels: [] };
      const runId = `fill-${nanoid()}`;
      const draft = state.roofPlanningDrafts[roof.id];
      const resolved = resolveSurfacePlanning(roof.surfacePlanning);

      if (mode === 'portrait' || mode === 'landscape') {
        const standardDraft = draft?.targetMode === 'standard' ? draft : undefined;
        const selectedPanel = standardDraft
          ? state.catalogPanels.find((candidate) => candidate.id === standardDraft.panelSpecId)
          : panel;
        if (!selectedPanel) return { mode, panels: [] };
        const generated = buildDirectStandardRoofLayout({
          roof,
          panel: selectedPanel,
          modules: standardDraft?.modules ?? state.modules,
          orientation: mode,
          moduleTilt: standardDraft?.moduleTilt ?? resolveStandardTiltInput(roof.surfacePlanning),
          mppImage,
          zones: state.zones,
          snowGuards: state.snowGuards,
          thermalFieldLimits: standardDraft?.thermalFieldLimits ??
            (resolved.status === 'supported-standard' ? resolved.config.thermalFieldLimits : undefined),
          createPanelId: (index) => `${roof.id}_${runId}_${index}`,
        });
        return { mode, panels: generated?.panels ?? [] };
      }

      const config = draft?.targetMode === 'advanced'
        ? draft.config
        : resolved.status === 'supported-advanced'
          ? resolved.config
          : undefined;
      if (!config) return { mode, panels: [] };
      const generated = buildDirectAdvancedRoofLayout({
        roof,
        // F fills available grid positions; a persisted fixed quantity must
        // not artificially restrict the additive candidate pool.
        config: setAdvancedQuantityMode({ config, mode: 'auto' }),
        mppImage,
        zones: state.zones,
        snowGuards: state.snowGuards,
        layoutRunId: runId,
        createPanelId: (index) => `${roof.id}_${runId}_${index}`,
      });
      return { mode, panels: generated?.panels ?? [] };
    };

    const selectionFor = (a: Pt, b: Pt, mode: ReturnType<typeof resolveRoofModuleMode>) => {
      if (mode === 'portrait' || mode === 'landscape') {
        return rectPolyFromAB(a, b, gridBasics(getAngleDeg()));
      }
      return axisAlignedRect(a, b);
    };

    const additivePanelsFor = (a: Pt, b: Pt) => {
      const state = usePlannerV2Store.getState();
      const roofId = state.selectedId;
      const roof = state.layers.find((candidate) => candidate.id === roofId);
      const mode = resolveRoofModuleMode({ roof, roofId, panels: state.panels });
      if (!roofId || !mode) return { poly: axisAlignedRect(a, b), panels: [] as PanelInstance[] };
      const poly = selectionFor(a, b, mode);
      return {
        poly,
        panels: selectAdditiveFillPanels({
          roofId,
          areaPolygon: poly,
          candidates: candidatesRef.current,
          existingPanels: state.panels,
        }),
      };
    };

    const handleMouseMove = () => {
      if (!drawingRef.current || !draftRef.current) return;
      const p = getMouseImg();
      if (!p) return;

      const a = draftRef.current.a;
      const b = p;
      draftRef.current = { a, b };

      const next = additivePanelsFor(a, b);
      const poly = next.poly;
      const rects = next.panels.map((panel) => ({
        cx: panel.cx, cy: panel.cy, wPx: panel.wPx, hPx: panel.hPx, angleDeg: panel.angleDeg,
      }));
      onDraftChange?.({ a, b, poly, rects });
    };

    const handleClick = (event: { evt?: { button?: number } }) => {
      if (!isPrimaryPointerButton(event?.evt?.button)) return;
      const p = getMouseImg();
      if (!p) return;

      // primo click → start
      if (!drawingRef.current) {
        drawingRef.current = true;
        draftRef.current = { a: p, b: p };
        candidatesRef.current = buildCandidates().panels;
        const next = additivePanelsFor(p, p);
        const poly = next.poly;
        const rects = next.panels.map((panel) => ({
          cx: panel.cx, cy: panel.cy, wPx: panel.wPx, hPx: panel.hPx, angleDeg: panel.angleDeg,
        }));
        onDraftChange?.({ a: p, b: p, poly, rects });
        return;
      }

      // secondo click → commit
      if (drawingRef.current && draftRef.current) {
        const a = draftRef.current.a;
        const b = draftRef.current.b;

        const state = usePlannerV2Store.getState();
        const roofId = state.selectedId;
        if (!roofId) {
          drawingRef.current = false;
          draftRef.current = null;
          onDraftChange?.(null);
          return;
        }
        const items = additivePanelsFor(a, b).panels;
        if (items.length > 0) {
          history.push('Fläche füllen');
          appendPanelsToRoof({ roofId, panels: items });
          toast.success(`${items.length} ${items.length === 1 ? 'Modul hinzugefügt' : 'Module hinzugefügt'}`);
        } else {
          toast('In diesem Bereich können keine weiteren Module platziert werden.');
        }

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
      candidatesRef.current = [];
      onDraftChange?.(null);
    };
  }, [stageRef, step, tool, layers, selectedId, modules.gridAngleDeg, toImgCoords, onDraftChange, appendPanelsToRoof, cancelVersion]);

  return null;
}
