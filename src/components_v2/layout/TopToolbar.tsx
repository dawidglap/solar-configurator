'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function TopToolbar() {
  const step = usePlannerV2Store((s) => s.step);

  // tool switch
  const tool = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  return (
    <div className="flex h-12 items-center justify-between">
      {/* Modus + Tool switch (links) */}
      <div className="flex items-center gap-3">
        <span className="mr-2 text-sm text-neutral-600">
          {step === 'building' && 'Modus: Gebäude'}
          {step === 'modules' && 'Modus: Module'}
          {step === 'strings' && 'Modus: Strings'}
          {step === 'parts' && 'Modus: Stückliste'}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTool('select')}
            className={`rounded-full px-3 py-1.5 text-sm border transition
              ${tool === 'select'
                ? 'bg-black text-white border-black'
                : 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-200'}`}
            title="Auswahl (V)"
          >
            Auswahl
          </button>

          <button
            type="button"
            onClick={() => setTool('draw-roof')}
            className={`rounded-full px-3 py-1.5 text-sm border transition
              ${tool === 'draw-roof'
                ? 'bg-black text-white border-black'
                : 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-200'}`}
            title="Dach zeichnen (P)"
          >
            Dach zeichnen
          </button>
        </div>
      </div>

      {/* Solo Save (rechts) */}
      <div className="flex items-center gap-2">
        <button
          className="ml-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          title="Speichern"
          onClick={() => alert('Speichern (kommt später)')}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}
