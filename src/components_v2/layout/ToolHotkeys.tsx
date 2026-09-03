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
import { resolveSurfacePlanning } from '@/lib/planning-core/advanced';
import {
  buildStandardPanelMetadata,
  buildStandardSurfacePlanning,
  resolveStandardTiltInput,
} from '../modules/advanced/advancedPlanningApplication';




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
  const catalogPanels       = usePlannerV2Store(s => s.catalogPanels);
  const roofPlanningDrafts  = usePlannerV2Store(s => s.roofPlanningDrafts);
  const commitRoofLayout    = usePlannerV2Store(s => s.commitRoofLayout);
  const setSelectedPanel    = usePlannerV2Store(s => s.setSelectedPanel);

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

    if (!selectedId || !snapshot?.mppImage) return;
    const roof = layers.find(l => l.id === selectedId);
    if (!roof?.points?.length) return;
    const standardDraft = roofPlanningDrafts[selectedId]?.targetMode === 'standard'
      ? roofPlanningDrafts[selectedId]
      : undefined;
    const standardModules = standardDraft?.modules ?? modules;
    const standardPanel = standardDraft
      ? catalogPanels.find((panel) => panel.id === standardDraft.panelSpecId)
      : selSpec;
    if (!standardPanel) return;

    const canvasAngleDeg = resolveStandardAutoLayoutCanvasAngle({
      roofId: selectedId,
      roofPolygon: roof.points,
      legacyRoofAzimuthDeg: roof.azimuthDeg,
      gridAngleDeg: standardModules.gridAngleDeg,
      perRoofAngles: standardModules.perRoofAngles,
      referenceEdgeIndex: roof.referenceEdgeIndex,
    });
    const currentState = usePlannerV2Store.getState();
    const obstacles = selectLegacyStandardObstacles(
      currentState.zones,
      currentState.snowGuards,
      selectedId,
    );
    const spacing = resolveStandardAutoLayoutSpacingAxes(standardModules);
    const result = computeLegacyStandardLayout({
      generation: {
        roofPolygon: roof.points,
        mppImage: snapshot.mppImage,
        canvasAngleDeg,
        orientation: standardModules.orientation,
        panelSizeM: { widthM: standardPanel.widthM, heightM: standardPanel.heightM },
        spacingM: spacing.x,
        spacingXM: spacing.x,
        spacingYM: spacing.y,
        marginM: resolveRoofEdgeMarginM(roof, standardModules.marginM),
        phaseX: standardModules.gridPhaseX ?? 0,
        phaseY: standardModules.gridPhaseY ?? 0,
        anchorX: standardModules.gridAnchorX ?? 'start',
        anchorY: standardModules.gridAnchorY ?? 'start',
        coverageRatio: standardModules.coverageRatio ?? 1,
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
    const moduleTilt = standardDraft?.moduleTilt ?? resolveStandardTiltInput(roof.surfacePlanning);
    const persistedStandard = resolveSurfacePlanning(roof.surfacePlanning);
    const thermalFieldLimits = standardDraft?.thermalFieldLimits ??
      (persistedStandard.status === 'supported-standard' ? persistedStandard.config.thermalFieldLimits : undefined);
    const standardMetadata = buildStandardPanelMetadata({ roofSlopeDeg: roof.tiltDeg, moduleTilt });
    const instances = orderedPlacements.map((r, idx) => ({
      id: `${selectedId}_p_${now}_${idx}`,
      roofId: selectedId,
      cx: r.cx, cy: r.cy,
      wPx: r.wPx, hPx: r.hPx,
      angleDeg: r.angleDeg,
      orientation: standardModules.orientation,
      panelId: standardPanel.id,
      ...(standardMetadata ? { standard: standardMetadata } : {}),
    }));

    commitRoofLayout({ roofId: selectedId, panels: instances, surfacePlanning: buildStandardSurfacePlanning({ roof, moduleTilt, thermalFieldLimits }) });
    setSelectedPanel(standardPanel.id);
    setModules({ ...standardModules, showGrid: false });
    setTool('select');
  }, [catalogPanels, commitRoofLayout, layers, modules, roofPlanningDrafts, selectedId, selSpec, setModules, setSelectedPanel, setStep, setTool, snapshot.mppImage, step]);

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
