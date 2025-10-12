// src/components_v2/modules/ModulesPanel.tsx
'use client';

import React from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';
import { MdViewModule } from 'react-icons/md';

// Modullayout: spostiamo qui il toggle (stesso componente già usato in TopToolbar)
import OrientationToggle from '../layout/TopToolbar/OrientationToggle';

type Pt = { x: number; y: number };

const inputBase =
  'w-full h-8 rounded-xl border border-neutral-200 bg-neutral-50/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const labelSm = 'block text-[10px] font-medium uppercase tracking-wide text-neutral-600';

export default function ModulesPanel() {
  // --- Stato layers ---
  const layers     = usePlannerV2Store(s => s.layers);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const select     = usePlannerV2Store(s => s.select);
  const del        = usePlannerV2Store(s => s.deleteLayer);
  const mpp        = usePlannerV2Store(s => s.snapshot.mppImage);
  const detected   = usePlannerV2Store(s => s.detectedRoofs);

  // --- Stato pannelli/moduli ---
  const panels     = usePlannerV2Store(s => s.panels);
  const modules    = usePlannerV2Store(s => s.modules);
  const setModules = usePlannerV2Store(s => s.setModules);
  const selSpec    = usePlannerV2Store(s => s.getSelectedPanel());

  return (
    <div className="w-full max-w-[240px] space-y-4 p-2">
{/* === EBENEN (ultra-compact, 1 row per roof, no cards) === */}
<div className="px-2">
  <div className="mb-1 text-[10px] font-semibold tracking-wide text-neutral-600">
    Ebenen{layers.length ? ` (${layers.length})` : ''}
  </div>

  {/* opzionale: import tetti rilevati, compatto */}
  {detected?.length > 0 && (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-medium text-neutral-700">Erkannte Dächer</div>
      <DetectedRoofsImport />
    </div>
  )}

  {layers.length === 0 ? (
    <p className="px-1 py-1 text-[11px] text-neutral-600">Noch keine Ebenen.</p>
  ) : (
    <ul className="text-[10px]">
      {layers.map((l, i) => {
        const roofId = l.id;
        const active = selectedId === roofId;

        const count = panels.filter(p => p.roofId === roofId).length;
        const kWp   = selSpec ? (selSpec.wp / 1000) * count : 0;

        return (
          <li key={roofId}>
            <div
              className={[
                'flex h-6 items-center gap-2 border-b border-neutral-200 px-1',
                active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50'
              ].join(' ')}
            >
              {/* D1 / D2 ... */}
              <button
                onClick={() => select(roofId)}
                title={l.name ?? `D${i + 1}`}
                aria-label={`Ebene auswählen: ${l.name ?? `D${i + 1}`}`}
                className="w-8 text-left font-semibold tracking-wide"
              >
                {`D${i + 1}`}
              </button>

              {/* moduli (icona + numero) */}
              <button
                onClick={() => select(roofId)}
                title={`${count} Module`}
                aria-label={`${count} Module`}
                className="inline-flex items-center gap-1 tabular-nums opacity-80 w-10"
              >
                <MdViewModule className="h-3 w-3" />
                <span>{count}</span>
              </button>

              {/* m² */}
              <div className="opacity-80 tabular-nums w-[52px] text-right">
                <RoofAreaInfo points={l.points as Pt[]} mpp={mpp} />
              </div>

              {/* kWp */}
              <div className="ml-auto opacity-80 tabular-nums w-[74px] text-right">
                {kWp ? kWp.toFixed(2) : '0,00'} kWp
              </div>

              {/* elimina */}
              <button
                onClick={() => del(roofId)}
                title="Löschen"
                aria-label={`Ebene löschen: ${l.name ?? `D${i + 1}`}`}
                className={[
                  'ml-1 text-[12px] leading-none',
                  active ? 'opacity-90 hover:opacity-100' : 'opacity-50 hover:opacity-100 hover:text-red-600'
                ].join(' ')}
              >
                ✕
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  )}
</div>



      {/* === RANDABSTAND === */}
      <section className="space-y-2">
        <label className={labelSm}>Randabstand</label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
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
          </div>
          <span className="pb-1 text-[10px] text-neutral-500">m</span>
        </div>
        {/* Nota: il “Abstand” (spaziatura tra pannelli) è stato rimosso dalla UI.
           Rimane a 0,02 m come default interno. */}
      </section>

      {/* === BLINDMODULE (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Blindmodule</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>Auswählen</option>
        </select>
      </section>

      {/* === UNTERKONSTRUKTION (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Unterkonstruktion</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>System auswählen</option>
        </select>
      </section>

      {/* === MODULLAYOUT (ora qui) === */}
      <section className="space-y-2">
        <label className={labelSm}>Modullayout</label>
        <OrientationToggle />
      </section>

      {/* === MODULNEIGUNG (placeholder, disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Modulneigung</label>
        <div className="flex items-end gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={0}
            disabled
            className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}
            aria-label="Modulneigung (%)"
          />
          <span className="pb-1 text-[10px] text-neutral-500">%</span>
        </div>
      </section>

      {/* === WECHSELRICHTER (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Wechselrichter</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>Auswählen</option>
        </select>
      </section>

      {/* Nessun KPI finale e nessun "Fläche leeren":
          i numeri sono su ogni Ebenen e la cancellazione avviene dalla toolbar/shortcut */}
    </div>
  );
}
