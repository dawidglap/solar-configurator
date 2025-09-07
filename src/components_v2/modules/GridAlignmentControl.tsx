// components_v2/modules/GridAlignmentControl.tsx
'use client';
import { usePlannerV2Store } from '../state/plannerV2Store';

const SEG = 1 / 3; // suddivisione slider: [Start][Mitte][Ende]

// mappa (anchor, phase) -> valore slider [0..1]
function toSlider(anchor: 'start'|'center'|'end', phase: number) {
  const p = Math.min(1, Math.max(0, isFinite(phase) ? phase : 0));
  if (anchor === 'start')  return 0 * SEG + p * SEG;
  if (anchor === 'center') return 1 * SEG + p * SEG;
  return 2 * SEG + p * SEG; // 'end'
}

// mappa valore slider -> (anchor, phase)
function fromSlider(v: number): { anchor: 'start'|'center'|'end'; phase: number } {
  const x = Math.min(1, Math.max(0, isFinite(v) ? v : 0));
  if (x < 1 * SEG)   return { anchor: 'start',  phase: x / SEG };
  if (x < 2 * SEG)   return { anchor: 'center', phase: (x - SEG) / SEG };
  return { anchor: 'end', phase: (x - 2 * SEG) / SEG };
}

const labelFor = (a: 'start'|'center'|'end') =>
  a === 'start' ? 'Start' : a === 'center' ? 'Mitte' : 'Ende';

export default function GridAlignmentControl() {
  const { gridAnchorY = 'start', gridPhaseY = 0, gridAnchorX = 'start', gridPhaseX = 0 } =
    usePlannerV2Store(s => s.modules);
  const setModules = usePlannerV2Store(s => s.setModules);

  // valori slider derivati dallo stato
  const sliderY = toSlider(gridAnchorY as any, gridPhaseY);
  const sliderX = toSlider(gridAnchorX as any, gridPhaseX);

  return (
    <fieldset className="space-y-3">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Raster-Ausrichtung
      </label>

      {/* Vertikal (Zeilen) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-neutral-600">Vertikal (Zeilen)</span>
          <span className="text-[10px] text-neutral-400">
            {labelFor(gridAnchorY as any)} · {gridPhaseY.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sliderY}
          onChange={e => {
            const { anchor, phase } = fromSlider(Number(e.target.value));
            setModules({ gridAnchorY: anchor as any, gridPhaseY: phase });
          }}
          className="w-full"
          aria-label="Vertikale Rasterausrichtung"
        />
        <div className="flex justify-between text-[9px] text-neutral-400 -mt-1">
          <span>Start</span><span>Mitte</span><span>Ende</span>
        </div>
      </div>

      {/* Horizontal (Spalten) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-neutral-600">Horizontal (Spalten)</span>
          <span className="text-[10px] text-neutral-400">
            {labelFor(gridAnchorX as any)} · {gridPhaseX.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sliderX}
          onChange={e => {
            const { anchor, phase } = fromSlider(Number(e.target.value));
            setModules({ gridAnchorX: anchor as any, gridPhaseX: phase });
          }}
          className="w-full"
          aria-label="Horizontale Rasterausrichtung"
        />
        <div className="flex justify-between text-[9px] text-neutral-400 -mt-1">
          <span>Start</span><span>Mitte</span><span>Ende</span>
        </div>
      </div>
    </fieldset>
  );
}
