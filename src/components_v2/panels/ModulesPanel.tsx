'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';
      // in cima al file
import { computeAutoLayoutRects } from '../modules/layout';
import { isInReservedZone } from '../zones/utils';
import GridRotationControl from '../modules/GridRotationControl';
import GridAlignmentControl from '../modules/GridAlignmentControl';
import GridCoverageControl from '../modules/GridCoverageControl';


// --- helper in cima al file (fuori dal componente)
function normDeg(d: number) { const x = d % 360; return x < 0 ? x + 360 : x; }
function angleDiffDeg(a: number, b: number) {
  let d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}
function longestEdgeAngleDeg(pts: {x:number;y:number}[]) {
  if (!pts || pts.length < 2) return 0;
  let best = 0, maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len2 = dx*dx + dy*dy;
    if (len2 > maxLen2) { maxLen2 = len2; best = Math.atan2(dy, dx) * 180/Math.PI; }
  }
  return best;
}





const inputBase =
  'w-full h-7 rounded-xl border border-neutral-200 bg-neutral-50/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const btnBase =
  'w-full h-8 rounded-full text-[11px] font-medium transition border';

const btnPrimary =
  'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:border-neutral-200 disabled:cursor-not-allowed';

const btnGhost =
  'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed';

const chip =
  'h-7 rounded-full border px-3 text-[11px] font-medium transition';

export default function ModulesPanel() {
  const modules            = usePlannerV2Store(s => s.modules);
  const setModules         = usePlannerV2Store(s => s.setModules);

  const catalogPanels      = usePlannerV2Store(s => s.catalogPanels);
  const selectedPanelId    = usePlannerV2Store(s => s.selectedPanelId);
  const setSelectedPanel   = usePlannerV2Store(s => s.setSelectedPanel);

  const selectedId         = usePlannerV2Store(s => s.selectedId);
  const panels             = usePlannerV2Store(s => s.panels);
  const clearPanelsForRoof = usePlannerV2Store(s => s.clearPanelsForRoof);

  const selSpec            = usePlannerV2Store(s => s.getSelectedPanel());
  const mpp                = usePlannerV2Store(s => s.snapshot.mppImage);

  const addPanelsForRoof = usePlannerV2Store(s => s.addPanelsForRoof);
const layers           = usePlannerV2Store(s => s.layers);
const snapshot         = usePlannerV2Store(s => s.snapshot);
const gridAngleDeg = usePlannerV2Store(s => s.modules.gridAngleDeg || 0);
const m = usePlannerV2Store.getState().modules;

  const panelsOnRoof = panels.filter(p => p.roofId === selectedId);
  const count  = panelsOnRoof.length;
  const areaM2 = (() => {
    if (!mpp) return 0;
    let a = 0;
    for (const p of panelsOnRoof) a += (p.wPx * p.hPx) * (mpp * mpp);
    return a;
  })();
  const kWp = selSpec ? (selSpec.wp / 1000) * count : 0;
  const disabled = !selectedId;

  return (
    <div className="w-full max-w-[240px] space-y-3 p-2">
      {/* HEAD */}
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-neutral-900">Module</h3>
        <span className="text-[10px] text-neutral-500">Planner V2</span>
      </div>

      {/* AUSRICHTUNG */}
      <fieldset className="space-y-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Ausrichtung
        </label>
        <select
          aria-label="Ausrichtung"
          value={modules.orientation}
          onChange={e => setModules({ orientation: e.target.value as any })}
          className={inputBase}
        >
          <option value="portrait">Portrait (vertikal)</option>
          <option value="landscape">Landscape (horizontal)</option>
        </select>
      </fieldset>

      

      {/* MODUL */}
      <fieldset className="space-y-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Modul
        </label>
        <select
          aria-label="Modul wählen"
          value={selectedPanelId}
          onChange={e => setSelectedPanel(e.target.value)}
          className={inputBase}
        >
          {catalogPanels.map(p => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.model} — {p.wp} W
            </option>
          ))}
        </select>
      </fieldset>

      {/* ABSTÄNDE (stack singola colonna, ultra-compatto) */}
      <fieldset className="space-y-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Abstände
        </label>

        <div className="space-y-2">
          {/* Abstand */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-600">Abstand</span>
              <span className="text-[10px] text-neutral-400">m</span>
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={modules.spacingM}
              onChange={e => setModules({ spacingM: Number(e.target.value) })}
              className={inputBase}
              placeholder="0,02"
              aria-label="Abstand (m)"
            />
            <p className="mt-1 text-[10px] text-neutral-400">Standard: 0,02</p>
          </div>

          {/* Randabstand */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-600">Randabstand</span>
              <span className="text-[10px] text-neutral-400">m</span>
            </div>
            <input
              type="number"
              step="0.05"
              min="0"
              value={modules.marginM}
              onChange={e => setModules({ marginM: Number(e.target.value) })}
              className={inputBase}
              placeholder="0,30"
              aria-label="Randabstand (m)"
            />
            <p className="mt-1 text-[10px] text-neutral-400">Beispiel: 0,30</p>
          </div>
        </div>
      </fieldset>

      <GridAlignmentControl />
      <GridRotationControl />

      {/* SEGMENT TOGGLES */}
      <div className="flex gap-2">
        <button
          onClick={() => setModules({ showGrid: !modules.showGrid })}
          className={[
            'flex-1', chip,
            modules.showGrid
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
          title="Raster ein/aus"
          aria-pressed={modules.showGrid}
        >
          {modules.showGrid ? 'Raster: AN' : 'Raster: AUS'}
        </button>

        {/* <button
          onClick={() => setModules({ placingSingle: !modules.placingSingle })}
          className={[
            'flex-1', chip,
            modules.placingSingle
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
          title="Einzelplatzierung"
          aria-pressed={modules.placingSingle}
        >
          {modules.placingSingle ? 'Einzel: AN' : 'Einzel: AUS'}
        </button> */}
      </div>

      {/* AKTIONEN */}
      <div className="space-y-2">
        <button
          disabled={disabled}
          onClick={() => console.info('[auto-layout] roof:', selectedId)}
          className={[btnBase, btnPrimary].join(' ')}
        >
          Auto-Layout
        </button>


{/* <GridCoverageControl /> */}
{/* // ...sostituisci l'onClick del bottone "In Module umwandeln" con: */}
<button
  disabled={disabled}
onClick={() => {
  if (!selectedId || !selSpec || !snapshot.mppImage) return;

const roof = layers.find(l => l.id === selectedId);
if (!roof) return;

// ⚠️ usa la stessa identica logica della preview
const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;
const polyDeg = (() => {
  let best = 0, len2 = -1;
  for (let i = 0; i < roof.points.length; i++) {
    const j = (i + 1) % roof.points.length;
    const dx = roof.points[j].x - roof.points[i].x;
    const dy = roof.points[j].y - roof.points[i].y;
    const L2 = dx*dx + dy*dy;
    if (L2 > len2) { len2 = L2; best = Math.atan2(dy, dx) * 180 / Math.PI; }
  }
  return best;
})();

// stessa soglia della preview
const baseCanvasDeg = (Math.abs(((eavesCanvasDeg - polyDeg) % 360 + 360) % 360) > 180
  ? 360 - Math.abs(((eavesCanvasDeg - polyDeg) % 360 + 360) % 360)
  : Math.abs(((eavesCanvasDeg - polyDeg) % 360 + 360) % 360)) > 5
  ? polyDeg
  : eavesCanvasDeg;

const gridCanvasDeg = baseCanvasDeg + (m.gridAngleDeg || 0);

const rects = computeAutoLayoutRects({
  polygon: roof.points,
  mppImage: snapshot.mppImage!,
  azimuthDeg: gridCanvasDeg,   // 👈 ora matcha la preview
  orientation: modules.orientation,
  panelSizeM: { w: selSpec.widthM, h: selSpec.heightM },
  spacingM: modules.spacingM,
  marginM: modules.marginM,
  phaseX: m.gridPhaseX || 0,
  phaseY: m.gridPhaseY || 0,
  anchorX: (m.gridAnchorX as any) || 'start',
  anchorY: (m.gridAnchorY as any) || 'start',
  coverageRatio: m.coverageRatio ?? 1,
});



  const safe = rects.filter(r => !isInReservedZone({ x: r.cx, y: r.cy }, selectedId));
  const instances = safe.map((r, idx) => ({
    id: `${selectedId}_p_${Date.now().toString(36)}_${idx}`,
    roofId: selectedId,
    cx: r.cx, cy: r.cy, wPx: r.wPx, hPx: r.hPx,
    angleDeg: r.angleDeg,
    orientation: modules.orientation,
    panelId: selSpec.id,
  }));

  addPanelsForRoof(selectedId, instances);
}}


  className={[
    'w-full rounded-full px-3 py-2 text-[13px] font-semibold border transition-colors',
    disabled ? 'bg-white text-neutral-400 border-neutral-200 cursor-not-allowed'
             : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
  ].join(' ')}
>
  In Module umwandeln
</button>

{/* <GridCoverageControl /> */}
        <button
          disabled={disabled || panelsOnRoof.length === 0}
          onClick={() => selectedId && clearPanelsForRoof(selectedId)}
          className={[btnBase, btnGhost].join(' ')}
        >
          Fläche leeren
        </button>
      </div>

      {/* KENNZAHLEN */}
      <div className="rounded-xl border border-neutral-200 bg-white/70 p-2">
        <Row label="Module" value={String(count)} />
        <Row label="Fläche" value={`${areaM2 ? areaM2.toFixed(1) : '0,0'} m²`} />
        <Row label="Leistung" value={`${kWp ? kWp.toFixed(2) : '0,00'} kWp`} />
      </div>

      {/* FOOT NOTE */}
      <p className="text-[10px] text-neutral-400 text-center">
        Änderungen werden sofort übernommen
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-neutral-600">{label}</span>
      <span className="text-[11px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
