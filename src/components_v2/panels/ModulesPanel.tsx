// src/components_v2/modules/ModulesPanel.tsx
'use client';

import React from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';

type Pt = { x: number; y: number };

const inputBase =
  'w-full h-7 rounded-xl border border-neutral-200 bg-neutral-50/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const btnBase = 'w-full h-8 rounded-full text-[11px] font-medium transition border';
const btnGhost =
  'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed';

export default function ModulesPanel() {
  // --- Stato per lista livelli (ex LeftLayersOverlay) ---
  const layers     = usePlannerV2Store(s => s.layers);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const select     = usePlannerV2Store(s => s.select);
  const del        = usePlannerV2Store(s => s.deleteLayer);
  const mpp        = usePlannerV2Store(s => s.snapshot.mppImage);
  const detected   = usePlannerV2Store(s => s.detectedRoofs);

  // --- Stato pannelli/moduli ---
  const modules            = usePlannerV2Store(s => s.modules);
  const setModules         = usePlannerV2Store(s => s.setModules);
  const panels             = usePlannerV2Store(s => s.panels);
  const clearPanelsForRoof = usePlannerV2Store(s => s.clearPanelsForRoof);
  const selSpec            = usePlannerV2Store(s => s.getSelectedPanel());

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
    <div className="w-full max-w-[240px] space-y-3 p-2 ">
      {/* === EBENEN (inline, sempre visibile) === */}
      <section className="rounded-2xl  border border-neutral-200 bg-white/85 backdrop-blur-sm shadow-sm">
        <div className="border-b bg-white/80 rounded-t-2xl px-3 py-2">
          <h3 className="text-xs font-semibold tracking-tight">
            Ebenen{layers.length ? ` (${layers.length})` : ''}
          </h3>
        </div>

        <div className="p-3 space-y-3">
          {/* Erkannte Dächer (se presenti) */}
          {detected?.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
              <h4 className="mb-1 text-[11px] font-semibold text-neutral-900">Erkannte Dächer</h4>
              <DetectedRoofsImport />
            </div>
          )}

          {/* Lista livelli */}
          {layers.length === 0 ? (
            <p className="text-xs text-neutral-600">Noch keine Ebenen.</p>
          ) : (
            <ul className="flex flex-col gap-1 pr-1">
              {layers.map((l) => {
                const active = selectedId === l.id;
                return (
                  <li key={l.id}>
                    <div
                      className={[
                        'flex items-center justify-between rounded-md border px-2 py-[2px] text-xs',
                        active
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50',
                      ].join(' ')}
                    >
                      <button
                        onClick={() => select(l.id)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={l.name}
                        aria-label={`Ebene auswählen: ${l.name}`}
                      >
                        {l.name}
                      </button>

                      <RoofAreaInfo points={l.points as Pt[]} mpp={mpp} />

                      <button
                        onClick={() => del(l.id)}
                        className={`ml-2 ${active ? 'opacity-90 hover:opacity-100' : 'text-neutral-400 hover:text-red-600'}`}
                        title="Löschen"
                        aria-label={`Ebene löschen: ${l.name}`}
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
      </section>
<div className='w-full border-b-1 border-neutral-200'></div>
      {/* === EIGENSCHAFTEN / ABSTÄNDE === */}
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

      {/* Azioni */}
      <div className="space-y-2">
        <button
          disabled={disabled || panelsOnRoof.length === 0}
          onClick={() => selectedId && clearPanelsForRoof(selectedId)}
          className={[btnBase, btnGhost].join(' ')}
        >
          Fläche leeren
        </button>
      </div>

      {/* KPI */}
      <div className="rounded-xl border border-neutral-200 bg-white/70 p-2">
        <Row label="Module" value={String(count)} />
        <Row label="Fläche" value={`${areaM2 ? areaM2.toFixed(1) : '0,0'} m²`} />
        <Row label="Leistung" value={`${kWp ? kWp.toFixed(2) : '0,00'} kWp`} />
      </div>

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
