// components_v2/modules/GridCoverageControl.tsx
'use client';
import { usePlannerV2Store } from '../state/plannerV2Store';

const STEPS = [0.5, 0.75, 1]; // ½, ¾, ganz
function snap(v: number) {
  const x = Math.min(1, Math.max(0.5, v));
  return STEPS.reduce((best, s) => (Math.abs(s - x) < Math.abs(best - x) ? s : best), STEPS[0]);
}

export default function GridCoverageControl() {
  const coverage = usePlannerV2Store(s => s.modules.coverageRatio ?? 1);
  const setModules = usePlannerV2Store(s => s.setModules);
  const val = coverage;

  return (
    <fieldset className="space-y-1.5">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Abdeckung (Zeilen)
      </label>

      <input
        type="range"
        min={0.5}
        max={1}
        step={0.01}
        value={val}
        onChange={e => setModules({ coverageRatio: snap(Number(e.target.value)) as any })}
        className="w-full"
        aria-label="Abdeckung des Dachs (Zeilen)"
      />
      <div className="flex justify-between text-[10px] text-neutral-600">
        <span>½ Dach</span>
        <span>¾ Dach</span>
        <span>Ganzes Dach</span>
      </div>
    </fieldset>
  );
}
