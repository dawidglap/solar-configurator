// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useCallback, useEffect } from 'react';
import {
  computeLegacyStandardLayout,
} from '@/lib/planning-core/legacy-standard';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';
import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutCommitAction,
  orderStandardAutoLayoutPlacements,
  resolveStandardAutoLayoutSpacingAxes,
  selectLegacyStandardObstacles,
  STANDARD_AUTO_LAYOUT_POLICY,
} from '../modules/legacyStandardApplicationPolicy';
import { shouldIgnorePlannerHotkeyTarget } from '../canvas/interactionPolicy';
import { resolvePlannerStepForTool, resolvePlannerToolHotkey } from './toolHotkeyPolicy';
import type { Tool } from '@/types/planner';
import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import { resolveRoofFallAzimuth } from '../roof/roofOrientation';




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
  const clearPanelsForRoof  = usePlannerV2Store(s => s.clearPanelsForRoof);

  const applyTool = useCallback((t: Tool, e?: KeyboardEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    const target = resolvePlannerStepForTool(t, step);
    if (target !== step) setStep(target);
    setTool(t);
  }, [setStep, setTool, step]);

  // ⬇️ stessa logica del bottone #3 (MdViewModule)
  const convertSelectedRoofToModules = useCallback(() => {
    // porta UI in modules
    if (step !== 'modules') setStep('modules');

    if (!selectedId || !selSpec || !snapshot?.mppImage) return;
    const roof = layers.find(l => l.id === selectedId);
    if (!roof?.points?.length) return;

    const canvasAngleDeg = resolveStandardAutoLayoutCanvasAngle({
      roofId: selectedId,
      roofPolygon: roof.points,
      legacyRoofAzimuthDeg: roof.azimuthDeg,
      gridAngleDeg: modules.gridAngleDeg,
      perRoofAngles: modules.perRoofAngles,
      referenceEdgeIndex: roof.referenceEdgeIndex,
    });
    const currentState = usePlannerV2Store.getState();
    const obstacles = selectLegacyStandardObstacles(
      currentState.zones,
      currentState.snowGuards,
      selectedId,
    );
    const spacing = resolveStandardAutoLayoutSpacingAxes(modules);
    const result = computeLegacyStandardLayout({
      generation: {
        roofPolygon: roof.points,
        mppImage: snapshot.mppImage,
        canvasAngleDeg,
        orientation: modules.orientation,
        panelSizeM: { widthM: selSpec.widthM, heightM: selSpec.heightM },
        spacingM: spacing.x,
        spacingXM: spacing.x,
        spacingYM: spacing.y,
        marginM: resolveRoofEdgeMarginM(roof, modules.marginM),
        phaseX: modules.gridPhaseX ?? 0,
        phaseY: modules.gridPhaseY ?? 0,
        anchorX: modules.gridAnchorX ?? 'start',
        anchorY: modules.gridAnchorY ?? 'start',
        coverageRatio: modules.coverageRatio ?? 1,
      },
      ...obstacles,
      filterPolicy: STANDARD_AUTO_LAYOUT_POLICY.filterPolicy,
    });
    const commitAction = resolveStandardAutoLayoutCommitAction(result.count);
    if (commitAction === 'preserve') return;

    const now = Date.now().toString(36);
    const orderedPlacements = orderStandardAutoLayoutPlacements(
      result.placements,
      {
        roofPolygon: roof.points,
        referenceEdgeIndex: roof.referenceEdgeIndex,
        fallAzimuthDeg: resolveRoofFallAzimuth(roof),
      },
    );
    const instances = orderedPlacements.map((r, idx) => ({
      id: `${selectedId}_p_${now}_${idx}`,
      roofId: selectedId,
      cx: r.cx, cy: r.cy,
      wPx: r.wPx, hPx: r.hPx,
      angleDeg: r.angleDeg,
      orientation: modules.orientation,
      panelId: selSpec.id,
    }));

    clearPanelsForRoof(selectedId);
    addPanelsForRoof(selectedId, instances);
    if (modules.showGrid) setModules({ showGrid: false });
    setTool('select');
  }, [addPanelsForRoof, clearPanelsForRoof, layers, modules, selectedId, selSpec, setModules, setStep, setTool, snapshot.mppImage, step]);

  useEffect(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const onKey = (e: KeyboardEvent) => {
      if (
        shouldIgnorePlannerHotkeyTarget(e.target) ||
        shouldIgnorePlannerHotkeyTarget(document.activeElement)
      ) return;
      const k = e.key?.toLowerCase();
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      // UNDO / REDO
      const isUndo = (isMac && meta && k === 'z' && !shift) || (!isMac && ctrl && k === 'z' && !shift);
      const isRedo = (isMac && meta && k === 'z' && shift) || (!isMac && ctrl && ((shift && k === 'z') || k === 'y'));
      const activeTool = usePlannerV2Store.getState().tool;
      const isDrawing = activeTool === 'draw-roof' || activeTool === 'draw-reserved' || activeTool === 'draw-reserved-rect' || activeTool === 'draw-rect';
      if (isDrawing && (isUndo || isRedo)) return;
      if (isUndo) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); history.undo(); return; }
      if (isRedo) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); history.redo(); return; }

      if (meta || ctrl || e.altKey) return;

      // TOOLS — sempre disponibili
      if (k === 'escape') return; // CanvasStage gestisce ESC con una sola priorità.
      const nextTool = resolvePlannerToolHotkey(k);
      if (nextTool) { applyTool(nextTool, e); return; }

      // NEW: Umwandeln → **U**
      if (k === 'u') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        convertSelectedRoofToModules();
        return;
      }
    };

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyTool, convertSelectedRoofToModules]);

  return null;
}
