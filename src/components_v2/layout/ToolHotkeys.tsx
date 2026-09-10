// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useCallback, useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';
import { shouldIgnorePlannerHotkeyTarget } from '../canvas/interactionPolicy';
import { resolvePlannerStepForTool, resolvePlannerToolHotkey } from './toolHotkeyPolicy';
import type { Tool } from '@/types/planner';




export default function ToolHotkeys() {
  const step            = usePlannerV2Store(s => s.step);
  const setStep         = usePlannerV2Store(s => s.setStep);
  const setTool         = usePlannerV2Store(s => s.setTool);


  const applyTool = useCallback((t: Tool, e?: KeyboardEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    const target = resolvePlannerStepForTool(t, step);
    if (target !== step) setStep(target);
    setTool(t);
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

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyTool, convertSelectedRoofToModules]);

  return null;
}
