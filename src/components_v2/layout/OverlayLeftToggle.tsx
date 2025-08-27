'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';
import { PanelLeft } from 'lucide-react';

export default function OverlayLeftToggle() {
  const toggleLeft = usePlannerV2Store((s) => s.toggleLeftPanelOpen);

  return (
    <button
      onClick={toggleLeft}
      className="
        absolute left-3 top-28 z-[300]
        rounded-full border border-neutral-200 bg-white/90
        px-3 py-2 text-sm shadow hover:bg-white
        transition-colors
      "
      title="Ebenen"
      aria-label="Ebenen"
    >
      <span className="inline-flex items-center gap-2">
        <PanelLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Ebenen</span>
      </span>
    </button>
  );
}
