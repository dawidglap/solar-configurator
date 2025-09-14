// src/components_v2/modules/ModulesTopbarFillAreaButton.tsx
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function ModulesTopbarFillAreaButton() {
  const step   = usePlannerV2Store(s => s.step);
  const tool   = usePlannerV2Store(s => s.tool);
  const setTool = usePlannerV2Store(s => s.setTool);

  if (step !== 'modules') return null; // visibile solo in modalità modules

  const active = tool === 'fill-area';

  return (
    <button
      type="button"
      onClick={() => setTool(active ? 'select' : 'fill-area')}
      className={[
        'h-8 px-3 rounded-full text-xs font-medium transition border',
        active
          ? 'bg-neutral-900 text-white border-neutral-900'
          : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
      ].join(' ')}
      title="Disegna rettangolo per riempire area"
      aria-pressed={active}
    >
      Riempi area
    </button>
  );
}
