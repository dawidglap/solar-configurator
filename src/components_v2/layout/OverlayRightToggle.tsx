'use client';

import { SlidersHorizontal } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function OverlayRightToggle() {
  const open    = usePlannerV2Store(s => s.ui.rightPanelOpen);
  const toggle  = usePlannerV2Store(s => s.toggleRightPanelOpen);
  const step    = usePlannerV2Store(s => s.step);
  const detCnt  = usePlannerV2Store(s => (s.detectedRoofs?.length ?? 0));

  // Primario nello step Module (properties first)
  const isPrimary = step === 'modules';

  const base = 'pointer-events-auto absolute top-[8px] right-3 z-[300] h-9 px-3 rounded-full border shadow inline-flex items-center gap-2 text-sm transition-colors  mt-20';
  const filled  = 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800';
  const outline = 'bg-white/90 text-neutral-800 border-neutral-200 hover:bg-white';
  const ring    = open ? 'ring-2 ring-blue-400/60' : '';

  return (
    

    
    <button
      type="button"
      title="Eigenschaften"
      aria-pressed={open}
      aria-controls="right-panel"
      onClick={toggle}
      className={[base, (open || isPrimary) ? filled : outline, ring].join(' ')}
    >
      <SlidersHorizontal className="w-4 h-4" />
      <span className="hidden sm:inline">Eigenschaften</span>

      {detCnt > 0 && (
        <span className="ml-1 rounded-full text-[11px] px-2 py-0.5 bg-white/20 border border-white/25">
          {detCnt}
        </span>
      )}
    </button>
    
  );
}
