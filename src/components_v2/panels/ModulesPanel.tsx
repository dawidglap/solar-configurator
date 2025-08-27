'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

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

        <button
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
        </button>
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

        <button
          disabled={disabled}
          onClick={() => console.info('[convert] roof:', selectedId)}
          className={[btnBase, btnGhost].join(' ')}
        >
          In Module umwandeln
        </button>

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
