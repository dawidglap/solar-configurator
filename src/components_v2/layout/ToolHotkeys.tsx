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
  const step    = usePlannerV2Store(s => s.step);
  const setTool = usePlannerV2Store(s => s.setTool);

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
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      history.undo();
      return;
    }
    if (isRedo) {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      history.redo();
      return;
    }

    // dopo aver gestito undo/redo, non blocchiamo altre combo con modifier
    if (meta || ctrl || e.altKey) return;

    // ── TOOLS HOTKEYS (senza modifier) ───────────────────
    if (k === 'a') { e.preventDefault(); setTool('select' as any); return; }
    if (k === 'escape') { setTool('select' as any); return; }

    if (step === 'building') {
      if (k === 'd') { e.preventDefault(); setTool('draw-roof' as any); return; }
      if (k === 'r') { e.preventDefault(); setTool('draw-rect' as any); return; }
      if (k === 'h') { e.preventDefault(); setTool('draw-reserved' as any); return; }
    } else if (step === 'modules') {
      if (k === 'f') { e.preventDefault(); setTool('fill-area' as any); return; }
    }
  };

  // ⬅️ usa capture per “battere sul tempo” eventuali handler che spostano il focus
  window.addEventListener('keydown', onKey, { capture: true });
  return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
}, [step, setTool]);


  return null;
}
