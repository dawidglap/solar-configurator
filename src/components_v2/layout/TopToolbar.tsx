'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function TopToolbar() {
  const step = usePlannerV2Store((s) => s.step);
  return (
    <div className="flex h-12 items-center justify-between">
      <div className="flex items-center gap-8">
        <span className="text-sm text-neutral-600">
          {step === 'building' && 'Modus: Gebäude'}
          {step === 'modules' && 'Modus: Module'}
          {step === 'strings' && 'Modus: Strings'}
          {step === 'parts' && 'Modus: Stückliste'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          title="Speichern"
          // wired in step BOM/persistence
          onClick={() => alert('Speichern (kommt später)')}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}
