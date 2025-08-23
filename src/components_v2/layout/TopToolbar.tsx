'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function TopToolbar() {
  const step = usePlannerV2Store((s) => s.step);
  const view = usePlannerV2Store((s) => s.view);
  const setView = usePlannerV2Store((s) => s.setView);

  const fit = view.fitScale || 1;
  const scale = view.scale || fit;

  const zoomBy = (factor: number) => {
    const next = Math.max(fit, Math.min(fit * 8, scale * factor));
    setView({ scale: next }); // CanvasStage clampa & centra gli offset
  };

  const resetToFit = () => setView({ scale: fit });

  const percent = Math.round((scale / fit) * 100);

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
          title="Verkleinern (mind. 100%)"
          onClick={() => zoomBy(1 / 1.2)}
        >
          −
        </button>

        <span className="min-w-[58px] text-center text-sm tabular-nums">
          {percent}%
        </span>

        <button
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          title="Vergrößern"
          onClick={() => zoomBy(1.2)}
        >
          +
        </button>

        <button
          className="ml-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          title="Auf 100% (Fit) zurücksetzen"
          onClick={resetToFit}
        >
          100%
        </button>

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
