'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function GridRotationControl() {
  const angle = usePlannerV2Store(s => s.modules.gridAngleDeg || 0);
  const setModules = usePlannerV2Store(s => s.setModules);

  const setAngle = (v: number) =>
    setModules({ gridAngleDeg: Math.max(-90, Math.min(90, Math.round(v))) });

  return (
    <fieldset className="space-y-1">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Rotazione Griglia
      </label>

      <div className="flex items-center gap-2">
        <button
          className="h-7 px-2 rounded-full border border-neutral-200 text-[11px]"
          onClick={() => setAngle(angle - 1)}
          title="-5°"
        >–1°</button>

        <input
          type="range"
          min={-90} max={90} step={0.1}
          value={angle}
          onChange={e => setAngle(Number(e.target.value))}
          className="flex-1"
          aria-label="Angolo griglia (°)"
        />

        <button
          className="h-7 px-2 rounded-full border border-neutral-200 text-[11px]"
          onClick={() => setAngle(angle + 1)}
          title="+5°"
        >+1°</button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-neutral-600 tabular-nums">{angle}°</span>
        <div className="flex gap-2">
          <button
            className="h-7 px-2 rounded-full border border-neutral-200 text-[10px]"
            onClick={() => setAngle(0)}
          >Reset 0°</button>
          <RoofAzimuthReset />
        </div>
      </div>
    </fieldset>
  );
}

// pulsante: allinea all'azimut del tetto selezionato (imposta 0° relativo)
function RoofAzimuthReset() {
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const layers     = usePlannerV2Store(s => s.layers);
  const setModules = usePlannerV2Store(s => s.setModules);
  const roof = layers.find(l => l.id === selectedId);

  if (!roof) return null;

  return (
    <button
      className="h-7 px-2 rounded-full border border-neutral-200 text-[10px]"
      onClick={() => setModules({ gridAngleDeg: 0 })}
      title="Allinea all'azimut falda"
    >
      Allinea falda
    </button>
  );
}
