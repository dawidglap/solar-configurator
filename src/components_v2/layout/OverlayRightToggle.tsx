'use client';

import { SlidersHorizontal } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function OverlayRightToggle() {
  const open = usePlannerV2Store(s => s.ui.rightPanelOpen);
  const toggle = usePlannerV2Store(s => s.toggleRightPanelOpen);

  return (
    <button
      type="button"
      title="Eigenschaften"
      aria-pressed={open}
      onClick={toggle}
      className={[
        'pointer-events-auto absolute top-[8px] right-3 z-[300]',
        'h-9 px-3 rounded-full border border-neutral-200 bg-white/90 shadow hover:bg-white',
        'inline-flex items-center gap-2 text-sm',
        open ? 'ring-2 ring-blue-400/60' : '',
      ].join(' ')}
    >
      <SlidersHorizontal className="w-4 h-4" />
      <span className="hidden sm:inline">Eigenschaften</span>
    </button>
  );
}
