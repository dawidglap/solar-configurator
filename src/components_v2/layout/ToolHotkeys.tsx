// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';

// ⬇️ stessi helper usati nel bottone #3
import { computeAutoLayoutRects } from '../modules/layout';   // <-- adegua path se serve
import { overlapsReservedRect } from '../zones/utils';        // <-- adegua path se serve

const isTextTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable);
};

export default function ToolHotkeys() {
  const step            = usePlannerV2Store(s => s.step);
  const setStep         = usePlannerV2Store(s => s.setStep);
  const setTool         = usePlannerV2Store(s => s.setTool);

  // Dati necessari per "In Module umwandeln"
  const layers              = usePlannerV2Store(s => s.layers);
  const selectedId          = usePlannerV2Store(s => s.selectedId);
  const modules             = usePlannerV2Store(s => s.modules);
  const setModules          = usePlannerV2Store(s => s.setModules);
  const snapshot            = usePlannerV2Store(s => s.snapshot);
  const selSpec             = usePlannerV2Store(s => s.getSelectedPanel());
  const addPanelsForRoof    = usePlannerV2Store(s => s.addPanelsForRoof);

  const stepForTool = (t: string): 'building' | 'modules' => {
    switch (t) {
      case 'fill-area':            return 'modules';
      case 'draw-roof':
      case 'draw-reserved':
      case 'draw-rect':            return 'building';
      default:                     return step as any;
    }
  };

  const applyTool = (t: any, e?: KeyboardEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.(); }
    const target = stepForTool(t);
    if (target && target !== step) setStep(target as any);
    setTool(t);
  };

  // ⬇️ stessa logica del bottone #3 (MdViewModule)
  const convertSelectedRoofToModules = () => {
    // porta UI in modules
    if (step !== 'modules') setStep('modules' as any);

    if (!selectedId || !selSpec || !snapshot?.mppImage) return;
    const roof = layers.find(l => l.id === selectedId);
    if (!roof?.points?.length) return;

    const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;

    // angolo lato più lungo
    let polyDeg = 0, len2 = -1;
    for (let i = 0; i < roof.points.length; i++) {
      const j = (i + 1) % roof.points.length;
      const dx = roof.points[j].x - roof.points[i].x;
      const dy = roof.points[j].y - roof.points[i].y;
      const L2 = dx * dx + dy * dy;
      if (L2 > len2) { len2 = L2; polyDeg = Math.atan2(dy, dx) * 180 / Math.PI; }
    }
    const norm = (d: number) => { const x = d % 360; return x < 0 ? x + 360 : x; };
    const diff = Math.abs(norm(eavesCanvasDeg - polyDeg));
    const small = diff > 180 ? 360 - diff : diff;
    const baseCanvasDeg = small > 5 ? polyDeg : eavesCanvasDeg;
    const azimuthDeg = baseCanvasDeg + (modules.gridAngleDeg || 0);

    const rectsAll = computeAutoLayoutRects({
      polygon: roof.points,
      mppImage: snapshot.mppImage!,
      azimuthDeg,
      orientation: modules.orientation,
      panelSizeM: { w: selSpec.widthM, h: selSpec.heightM },
      spacingM: modules.spacingM,
      marginM:  modules.marginM,
      phaseX:   modules.gridPhaseX ?? 0,
      phaseY:   modules.gridPhaseY ?? 0,
      anchorX: (modules.gridAnchorX as 'start'|'center'|'end') ?? 'start',
      anchorY: (modules.gridAnchorY as 'start'|'center'|'end') ?? 'start',
      coverageRatio: modules.coverageRatio ?? 1,
    });

    const rects = rectsAll.filter(r =>
      !overlapsReservedRect(
        { cx: r.cx, cy: r.cy, w: r.wPx, h: r.hPx, angleDeg: r.angleDeg },
        selectedId,
        1
      )
    );
    if (!rects.length) return;

    const now = Date.now().toString(36);
    const instances = rects.map((r, idx) => ({
      id: `${selectedId}_p_${now}_${idx}`,
      roofId: selectedId,
      cx: r.cx, cy: r.cy,
      wPx: r.wPx, hPx: r.hPx,
      angleDeg: r.angleDeg,
      orientation: modules.orientation,
      panelId: selSpec.id,
    }));

    addPanelsForRoof(selectedId, instances);
    if (modules.showGrid) setModules({ showGrid: false });
    setTool('select' as any);
  };

  useEffect(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;

      const k = e.key?.toLowerCase();
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      // UNDO / REDO
      const isUndo = (isMac && meta && k === 'z' && !shift) || (!isMac && ctrl && k === 'z' && !shift);
      const isRedo = (isMac && meta && k === 'z' && shift) || (!isMac && ctrl && ((shift && k === 'z') || k === 'y'));
      if (isUndo) { e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.(); history.undo(); return; }
      if (isRedo) { e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.(); history.redo(); return; }

      if (meta || ctrl || e.altKey) return;

      // TOOLS — sempre disponibili
      if (k === 'a') { applyTool('select', e); return; }
      if (k === 'escape') { setTool('select' as any); return; }
      if (k === 'd') { applyTool('draw-roof', e); return; }
      if (k === 'r') { applyTool('draw-rect', e); return; }
      if (k === 'h') { applyTool('draw-reserved', e); return; }
      if (k === 'f') { applyTool('fill-area', e); return; }

      // NEW: Umwandeln → **U**
      if (k === 'u') {
        e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
        convertSelectedRoofToModules();
        return;
      }
    };

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [step, setStep, setTool, layers, selectedId, modules, setModules, snapshot, selSpec, addPanelsForRoof]);

  return null;
}
