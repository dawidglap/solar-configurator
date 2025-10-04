'use client';

import { useCallback } from 'react';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import { history as plannerHistory } from '@/components_v2/state/history';

type Orientation = 'portrait' | 'landscape';

export default function OrientationToggle() {
  // legge lo stesso stato usato dalla sidebar
  const orientation = usePlannerV2Store((s) => s.modules.orientation as Orientation);

  // prova gli stessi setter della sidebar; altrimenti fallback sicuro
  const setOrientation = useCallback((o: Orientation) => {
    const st: any = usePlannerV2Store.getState();

    if (typeof st.setModulesOrientation === 'function') {
      plannerHistory?.push?.(`orientation: ${o}`);
      st.setModulesOrientation(o);
      return;
    }
    if (typeof st.setModules === 'function') {
      plannerHistory?.push?.(`orientation: ${o}`);
      st.setModules({ ...st.modules, orientation: o });
      return;
    }
    if (typeof st.updateModules === 'function') {
      plannerHistory?.push?.(`orientation: ${o}`);
      st.updateModules({ orientation: o });
      return;
    }

    // fallback
    plannerHistory?.push?.(`orientation: ${o}`);
    (usePlannerV2Store as any).setState(
      (prev: any) => ({ ...prev, modules: { ...prev.modules, orientation: o } }),
      false,
      'modules.orientation'
    );
  }, []);

  return (
    <div
      className="ml-1 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white/80 px-1 py-0.5"
      aria-label="Ausrichtung"
    >
      <button
        type="button"
        onClick={() => setOrientation('portrait')}
        className={`h-8 px-3 rounded-[999px] text-[10px] uppercase tracking-wide font-medium ${
          orientation === 'portrait'
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-800 hover:bg-neutral-100'
        }`}
        title="Portrait (vertikal)"
      >
        Senkrecht
      </button>
      <button
        type="button"
        onClick={() => setOrientation('landscape')}
        className={`h-8 px-3 rounded-[999px] text-[10px] uppercase tracking-wide font-medium ${
          orientation === 'landscape'
            ? 'bg-neutral-900 text-white'
            : 'text-neutral-800 hover:bg-neutral-100'
        }`}
        title="Landscape (horizontal)"
      >
        Waagerecht
      </button>
    </div>
  );
}
