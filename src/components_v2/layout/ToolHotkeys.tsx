// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useEffect } from 'react';
import {
  computeLegacyStandardLayout,
  resolveLegacyStandardCanvasAngle,
} from '@/lib/planning-core/legacy-standard';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';
import {
  resolveLegacyStandardCommitAction,
  selectLegacyStandardObstacles,
  TOOL_HOTKEYS_LEGACY_POLICY,
} from '../modules/legacyStandardApplicationPolicy';

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

    const canvasAngleDeg = resolveLegacyStandardCanvasAngle({
      roofPolygon: roof.points,
      legacyRoofAzimuthDeg: roof.azimuthDeg,
      gridAngleDeg: modules.gridAngleDeg,
    });
    const currentState = usePlannerV2Store.getState();
    const obstacles = selectLegacyStandardObstacles(
      currentState.zones,
      currentState.snowGuards,
      selectedId,
    );
    const result = computeLegacyStandardLayout({
      generation: {
        roofPolygon: roof.points,
        mppImage: snapshot.mppImage,
        canvasAngleDeg,
        orientation: modules.orientation,
        panelSizeM: { widthM: selSpec.widthM, heightM: selSpec.heightM },
        spacingM: modules.spacingM,
        marginM: modules.marginM,
        phaseX: modules.gridPhaseX ?? 0,
        phaseY: modules.gridPhaseY ?? 0,
        anchorX: modules.gridAnchorX ?? 'start',
        anchorY: modules.gridAnchorY ?? 'start',
        coverageRatio: modules.coverageRatio ?? 1,
      },
      ...obstacles,
      filterPolicy: TOOL_HOTKEYS_LEGACY_POLICY.filterPolicy,
    });
    const commitAction = resolveLegacyStandardCommitAction(
      TOOL_HOTKEYS_LEGACY_POLICY,
      result.count,
    );
    if (commitAction !== 'append') return;

    const now = Date.now().toString(36);
    const instances = result.placements.map((r, idx) => ({
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
      // Evita l'undo/redo globale mentre sto disegnando (lascia fare all'hook)
const t = usePlannerV2Store.getState().tool;
if (t === 'draw-roof' || t === 'draw-reserved' || t === 'draw-rect') {
  return; // non gestire qui: l'hook intercetterà Cmd/Ctrl+Z
}

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
    const st = usePlannerV2Store.getState();
// Se c'è una zona selezionata, NON gestire qui Delete.
// (La priorità di delete-zone è più alta)
if (st.selectedZoneId) return;

    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [step, setStep, setTool, layers, selectedId, modules, setModules, snapshot, selSpec, addPanelsForRoof]);

  return null;
}
