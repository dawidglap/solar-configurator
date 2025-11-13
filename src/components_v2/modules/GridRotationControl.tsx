// src/components_v2/modules/GridRotationControl.tsx
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

const MIN_ANGLE = -90;
const MAX_ANGLE = 90;

function clampAngle(v: number) {
  return Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, Math.round(v)));
}

export default function GridRotationControl() {
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const modules = usePlannerV2Store((s) => s.modules);
  const setModules = usePlannerV2Store((s) => s.setModules);

  // globale (fallback)
  const globalAngle = modules?.gridAngleDeg ?? 0;

  // mappa override per falda
  const perRoofAngles: Record<string, number> = modules?.perRoofAngles ?? {};

  // angolo effettivo da mostrare
  const effectiveAngle =
    selectedId && perRoofAngles[selectedId] !== undefined
      ? perRoofAngles[selectedId]!
      : globalAngle;

  const hasRoofOverride = !!(selectedId && perRoofAngles[selectedId] !== undefined);

  // cambia angolo globale
  const setGlobalAngle = (v: number) => {
    const ang = clampAngle(v);
    setModules({ gridAngleDeg: ang });
  };

  // cambia/crea override solo per la falda selezionata
  const setRoofAngle = (v: number) => {
    if (!selectedId) return;
    const ang = clampAngle(v);
    setModules({
      perRoofAngles: {
        [selectedId]: ang,
      },
    });
  };

  // resetta l'override della falda selezionata → torna al globale
  const clearRoofAngle = () => {
    if (!selectedId) return;
    // mandiamo undefined per questa falda: nello store lo togliamo
    setModules({
      perRoofAngles: {
        [selectedId]: undefined as unknown as number,
      },
    });
  };

  // handler unico: se c’è una falda selezionata con override → aggiorna lei,
  // altrimenti aggiorna il globale
  const setAngle = (v: number) => {
    if (selectedId) {
      // se c'è una falda selezionata, lavoriamo su di lei
      setRoofAngle(v);
    } else {
      setGlobalAngle(v);
    }
  };

  return (
    <fieldset className="space-y-1.5">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Raster-Drehung
      </label>

      <div className="flex items-center gap-2">
        <button
          className="h-6 px-1.5 rounded-full border border-neutral-200 text-[10px] leading-none"
          onClick={() => setAngle(effectiveAngle - 1)}
          title="-1°"
          aria-label="Raster um minus 1 Grad drehen"
        >
          –°
        </button>

        <input
          type="range"
          min={MIN_ANGLE}
          max={MAX_ANGLE}
          step={1}
          value={effectiveAngle}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="flex-1"
          aria-label="Rasterwinkel (°)"
        />

        <button
          className="h-6 px-1.5 rounded-full border border-neutral-200 text-[10px] leading-none"
          onClick={() => setAngle(effectiveAngle + 1)}
          title="+1°"
          aria-label="Raster um plus 1 Grad drehen"
        >
          +°
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-neutral-600 tabular-nums">
          {effectiveAngle}°
          {selectedId && hasRoofOverride ? ' (falda)' : ''}
        </span>

        <div className="flex gap-2">
          {/* reset globale */}
          <button
            className="h-6 px-2 rounded-full border border-neutral-200 text-[10px] leading-none"
            onClick={() => setGlobalAngle(0)}
            title="Winkel global auf 0° zurücksetzen"
          >
            Global 0°
          </button>

          {/* se c'è una falda selezionata, mostra i bottoni per lei */}
          {selectedId ? (
            hasRoofOverride ? (
              <button
                className="h-6 px-2 rounded-full border border-neutral-200 text-[10px] leading-none"
                onClick={clearRoofAngle}
                title="Override per falda entfernen"
              >
                Falda ↩︎ globale
              </button>
            ) : (
              <button
                className="h-6 px-2 rounded-full border border-neutral-200 text-[10px] leading-none"
                onClick={() => setRoofAngle(globalAngle)}
                title="Override per falda erstellen"
              >
                Falda = globale
              </button>
            )
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
