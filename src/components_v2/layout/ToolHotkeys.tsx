// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useCallback, useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';
import {
  hasOpenPlannerKeyboardOverlay,
  shouldIgnorePlannerHotkeyTarget,
} from '../canvas/interactionPolicy';
import {
  resolvePlannerStepForTool,
  resolvePlannerToolHotkey,
  resolveRoofShapeModeHotkey,
} from './toolHotkeyPolicy';
import type { Tool } from '@/types/planner';
import { exitManualPlacementToSelect } from '../modules/manualPlacementSession';




export default function ToolHotkeys() {
  const step            = usePlannerV2Store(s => s.step);
  const setStep         = usePlannerV2Store(s => s.setStep);
  const setTool         = usePlannerV2Store(s => s.setTool);


  const applyTool = useCallback((t: Tool, e?: KeyboardEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    const target = resolvePlannerStepForTool(t, step);
    if (target !== step) setStep(target);
    if (t === 'select') exitManualPlacementToSelect(setTool);
    else setTool(t);
  }, [setStep, setTool, step]);

  const convertSelectedRoofToModules = useCallback(() => {
    document.getElementById('planner-regenerate-layout')?.click();
  }, []);

  useEffect(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const onKey = (e: KeyboardEvent) => {
      if (
        shouldIgnorePlannerHotkeyTarget(e.target) ||
        shouldIgnorePlannerHotkeyTarget(document.activeElement)
      ) return;
      const k = e.key?.toLowerCase();
      if ((k === 'escape' || k === 'a') && hasOpenPlannerKeyboardOverlay(document)) return;
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

      const state = usePlannerV2Store.getState();
      const roofShapeMode = resolveRoofShapeModeHotkey({
        key: k,
        step,
        hasSelectedRoof: Boolean(state.selectedId),
      });
      if (roofShapeMode) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (roofShapeMode === 'trapezio') exitManualPlacementToSelect(state.setTool);
        state.setUI({ roofShapeMode });
        return;
      }

      // Escape and A share the canonical Auswählen action. A tool change also
      // drops transient drawing/fill state without committing it.
      if (k === 'escape') { applyTool('select', e); return; }

      // TOOLS — sempre disponibili
      if (k === 'f') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        document.getElementById('planner-fill-layout')?.click();
        return;
      }
      const nextTool = resolvePlannerToolHotkey(k);
      if (nextTool) { applyTool(nextTool, e); return; }

      // NEW: Umwandeln → **U**
      if (k === 'u') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        convertSelectedRoofToModules();
        return;
      }
    };

    // Focused controls and overlays get the first chance to consume Escape.
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyTool, convertSelectedRoofToModules]);

  return null;
}
