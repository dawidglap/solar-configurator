'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

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
    <div className="space-y-4">
      {/* Ausrichtung */}
      <fieldset className="space-y-1">
        <label className="text-[11px] font-medium text-neutral-700">Ausrichtung</label>
        <select
          value={modules.orientation}
          onChange={e => setModules({ orientation: e.target.value as any })}
          className="w-full rounded-2xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-[13px] font-semibold shadow-inner outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="portrait">Portrait (vertikal)</option>
          <option value="landscape">Landscape (horizontal)</option>
        </select>
      </fieldset>

      {/* Modul */}
      <fieldset className="space-y-1">
        <label className="text-[11px] font-medium text-neutral-700">Modul</label>
        <select
          value={selectedPanelId}
          onChange={e => setSelectedPanel(e.target.value)}
          className="w-full rounded-2xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-[13px] font-semibold shadow-inner outline-none focus:ring-2 focus:ring-blue-400"
        >
          {catalogPanels.map(p => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.model} — {p.wp} W
            </option>
          ))}
        </select>
      </fieldset>

      {/* Abstände */}
      <div className="grid grid-cols-2 gap-2">
        <fieldset className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-700">Abstand</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={modules.spacingM}
            onChange={e => setModules({ spacingM: Number(e.target.value) })}
            className="w-full rounded-2xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-[13px] font-semibold shadow-inner outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-[10px] text-neutral-500">m (Standard 0,02)</p>
        </fieldset>

        <fieldset className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-700">Randabstand</label>
          <input
            type="number"
            step="0.05"
            min="0"
            value={modules.marginM}
            onChange={e => setModules({ marginM: Number(e.target.value) })}
            className="w-full rounded-2xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-[13px] font-semibold shadow-inner outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-[10px] text-neutral-500">m (z. B. 0,30)</p>
        </fieldset>
      </div>

      {/* Toggles */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setModules({ showGrid: !modules.showGrid })}
          className={[
            'flex-1 rounded-full border px-3 py-1.5 text-[13px] font-medium',
            modules.showGrid
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
          title="Raster ein/aus"
        >
          {modules.showGrid ? 'Raster: AN' : 'Raster: AUS'}
        </button>

        <button
          onClick={() => setModules({ placingSingle: !modules.placingSingle })}
          className={[
            'flex-1 rounded-full border px-3 py-1.5 text-[13px] font-medium',
            modules.placingSingle
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
          title="Einzelplatzierung"
        >
          {modules.placingSingle ? 'Einzel: AN' : 'Einzel: AUS'}
        </button>
      </div>

      {/* Aktionen */}
      <div className="space-y-2 pt-1">
        <button
          disabled={disabled}
          onClick={() => console.info('[auto-layout] roof:', selectedId)}
          className={[
            'w-full rounded-full px-3 py-2 text-[13px] font-semibold shadow transition-colors',
            disabled ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
                     : 'bg-neutral-900 text-white hover:bg-neutral-800'
          ].join(' ')}
        >
          Auto-Layout
        </button>

        <button
          disabled={disabled}
          onClick={() => console.info('[convert] roof:', selectedId)}
          className={[
            'w-full rounded-full px-3 py-2 text-[13px] font-semibold border transition-colors',
            disabled ? 'bg-white text-neutral-400 border-neutral-200 cursor-not-allowed'
                     : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
        >
          In Module umwandeln
        </button>

        <button
          disabled={disabled || panelsOnRoof.length === 0}
          onClick={() => selectedId && clearPanelsForRoof(selectedId)}
          className={[
            'w-full rounded-full px-3 py-2 text-[13px] font-medium border transition-colors',
            disabled || panelsOnRoof.length === 0
              ? 'bg-white text-neutral-400 border-neutral-200 cursor-not-allowed'
              : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
        >
          Fläche leeren
        </button>
      </div>

      {/* Kennzahlen */}
      <div className="mt-2 rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-neutral-600">Module</span>
          <span className="font-semibold">{count}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-600">Fläche</span>
          <span className="font-semibold">{areaM2 ? areaM2.toFixed(1) : '0,0'} m²</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-600">Leistung</span>
          <span className="font-semibold">{kWp ? kWp.toFixed(2) : '0,00'} kWp</span>
        </div>
      </div>
    </div>
  );
}
