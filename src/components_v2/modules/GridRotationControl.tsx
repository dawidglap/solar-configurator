// components_v2/modules/GridRotationControl.tsx
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function GridRotationControl() {
  const angle = usePlannerV2Store((s) => s.modules.gridAngleDeg || 0);
  const setModules = usePlannerV2Store((s) => s.setModules);

  const setAngle = (v: number) =>
    setModules({ gridAngleDeg: Math.max(-90, Math.min(90, Math.round(v))) });

  return (
    <fieldset className="space-y-1.5">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Raster-Drehung
      </label>

      <div className="flex items-center gap-2">
        <button
          className="h-6 px-1.5 rounded-full border border-neutral-200 text-[10px] leading-none"
          onClick={() => setAngle(angle - 1)}
          title="-1°"
          aria-label="Raster um minus 1 Grad drehen"
        >
          –°
        </button>

        <input
          type="range"
          min={-90}
          max={90}
          step={1}
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="flex-1"
          aria-label="Rasterwinkel (°)"
        />

        <button
          className="h-6 px-1.5 rounded-full border border-neutral-200 text-[10px] leading-none"
          onClick={() => setAngle(angle + 1)}
          title="+1°"
          aria-label="Raster um plus 1 Grad drehen"
        >
          +°
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-neutral-600 tabular-nums">{angle}°</span>
        <div className="flex gap-2">
          <button
            className="h-6 px-2 rounded-full border border-neutral-200 text-[10px] leading-none"
            onClick={() => setAngle(0)}
            title="Winkel auf 0° zurücksetzen"
          >
            0° zurücksetzen
          </button>
          <RoofAzimuthReset />
        </div>
      </div>
    </fieldset>
  );
}

// Button: relative 0° zur Dachausrichtung (Azimut)
function RoofAzimuthReset() {
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const layers = usePlannerV2Store((s) => s.layers);
  const setModules = usePlannerV2Store((s) => s.setModules);
  const roof = layers.find((l) => l.id === selectedId);

  if (!roof) return null;

  return (
    <button
      className="h-6 px-2 rounded-full border border-neutral-200 text-[10px] leading-none"
      onClick={() => setModules({ gridAngleDeg: 0 })}
      title="Auf Dach-Azimut ausrichten"
    >
      Am Dach ausrichten
    </button>
  );
}
