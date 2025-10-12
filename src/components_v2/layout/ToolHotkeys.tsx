// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';

const isTextTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable);
};

export default function ToolHotkeys() {
  const step     = usePlannerV2Store(s => s.step);
  const setStep  = usePlannerV2Store(s => s.setStep);
  const setTool  = usePlannerV2Store(s => s.setTool);

  // ── mappa tool → step (coerente con TopToolbar)
  const stepForTool = (t: string): 'building' | 'modules' => {
    switch (t) {
      case 'fill-area':            return 'modules';   // tool moduli
      case 'draw-roof':
      case 'draw-reserved':
      case 'draw-rect':            return 'building';  // tool building
      default:                     return step as any; // select, ecc.
    }
  };

  const applyTool = (t: any, e?: KeyboardEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.(); }
    const target = stepForTool(t);
    if (target && target !== step) setStep(target as any);
    setTool(t);
  };

  useEffect(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;

      const k = e.key?.toLowerCase();
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      // ── UNDO / REDO (in capture) ─────────────────────────
      const isUndo = (isMac && meta && k === 'z' && !shift) || (!isMac && ctrl && k === 'z' && !shift);
      const isRedo = (isMac && meta && k === 'z' && shift) || (!isMac && ctrl && ((shift && k === 'z') || k === 'y'));

      if (isUndo) {
        e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
        history.undo();
        return;
      }
      if (isRedo) {
        e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
        history.redo();
        return;
      }

      // dopo undo/redo, non blocchiamo altre combo con modifier
      if (meta || ctrl || e.altKey) return;

      // ── TOOLS HOTKEYS (senza modifier) — sempre disponibili ──
      if (k === 'a') { applyTool('select', e); return; }
      if (k === 'escape') { setTool('select' as any); return; }

      // building tools
      if (k === 'd') { applyTool('draw-roof', e); return; }       // Dach zeichnen
      if (k === 'r') { applyTool('draw-rect', e); return; }       // Rechteck zeichnen
      if (k === 'h') { applyTool('draw-reserved', e); return; }   // Hindernis / Reservierte Zone

      // modules tools
      if (k === 'f') { applyTool('fill-area', e); return; }       // Fläche füllen
    };

    // capture per “battere” eventuali handler di focus
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [step, setStep, setTool]);

  return null;
}
