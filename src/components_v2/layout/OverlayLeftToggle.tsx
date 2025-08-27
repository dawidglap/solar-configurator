'use client';

import { PanelLeft } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function OverlayLeftToggle() {
  const open   = usePlannerV2Store((s) => s.ui.leftPanelOpen);
  const toggle = usePlannerV2Store((s) => s.toggleLeftPanelOpen);

  return (
    <button
      type="button"
      title="Ebenen"
      aria-pressed={open}
      onClick={toggle}
      className={[
        'pointer-events-auto absolute top-[8px] left-3 z-[300]',
        'h-9 px-3 rounded-full border border-neutral-200 bg-white/90 shadow hover:bg-white',
        'inline-flex items-center gap-2 text-sm',
        open ? 'ring-2 ring-blue-400/60' : '',
      ].join(' ')}
    >
      <PanelLeft className="w-4 h-4" />
      <span className="hidden sm:inline">Ebenen</span>
    </button>
  );
}
