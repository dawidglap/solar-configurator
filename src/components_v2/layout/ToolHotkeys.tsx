// src/components_v2/layout/ToolHotkeys.tsx
'use client';

import { useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

const isTextTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable);
};

export default function ToolHotkeys() {
  const step    = usePlannerV2Store(s => s.step);
  const setTool = usePlannerV2Store(s => s.setTool);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // lasciamo libere le combo

      const k = e.key.toLowerCase();

      // comuni
      if (k === 'a') { e.preventDefault(); setTool('select' as any); return; }
      if (k === 'escape') { setTool('select' as any); return; }

      if (step === 'building') {
        if (k === 'd') { e.preventDefault(); setTool('draw-roof' as any); return; }   // Dach
        if (k === 'r') { e.preventDefault(); setTool('draw-rect' as any); return; }   // Rechteck
        if (k === 'h') { e.preventDefault(); setTool('draw-reserved' as any); return; } // Hindernis
      } else if (step === 'modules') {
        if (k === 'f') { e.preventDefault(); setTool('fill-area' as any); return; }   // Fläche füllen
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, setTool]);

  return null;
}
