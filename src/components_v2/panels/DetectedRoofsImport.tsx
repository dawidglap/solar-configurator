'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

function areaM2(points: { x: number; y: number }[], mpp?: number) {
  if (!mpp || points.length < 3) return undefined;
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  const px2 = Math.abs(a / 2);
  return px2 * mpp * mpp;
}

export default function DetectedRoofsImport() {
  const snapshot = usePlannerV2Store(s => s.snapshot);
  const detected = usePlannerV2Store(s => s.detectedRoofs);
  const addRoof  = usePlannerV2Store(s => s.addRoof);
  const clearDet = usePlannerV2Store(s => s.clearDetectedRoofs);
  const select   = usePlannerV2Store(s => s.select);
  const layers   = usePlannerV2Store(s => s.layers);

  // Selezione (default: tutti)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(detected.map(d => d.id)));
  }, [detected]);

  const mpp = snapshot.mppImage;

  const rows = useMemo(() => {
    return detected.map(d => ({
      ...d,
      area: areaM2(d.points, mpp),
    }));
  }, [detected, mpp]);

  const allChecked = selected.size > 0 && selected.size === detected.length;

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => (prev.size === detected.length ? new Set() : new Set(detected.map(d => d.id))));
  };

  const importSelected = () => {
    if (selected.size === 0) return;

    // Continua la numerazione dopo i layer esistenti
    const already = layers.filter(l => l.name?.startsWith('Dach ')).length;
    const addedIds: string[] = [];

    let idx = 0;
    for (const d of detected) {
      if (!selected.has(d.id)) continue;
      const name = `Dach ${String.fromCharCode(65 + already + idx)}`; // A,B,C…
      const id = `roof_${Date.now().toString(36)}_${idx}`;
      addRoof({
        id,
        name,
        points: d.points,
        tiltDeg: d.tiltDeg,
        azimuthDeg: d.azimuthDeg,
        source: 'sonnendach',
      });
      addedIds.push(id);
      idx++;
    }
    if (addedIds.length) select(addedIds[0]);
    clearDet();
  };

  if (detected.length === 0) return null;

  // Sommarietto compatto
  const totalSel = selected.size;
  const totalArea = rows
    .filter(r => selected.has(r.id) && r.area != null)
    .reduce((s, r) => s + (r.area as number), 0);

  return (
    <section className=" rounded-lg text-[12px]">
      {/* Header + toggle all */}
      <div className="mb-2">
        <div className="font-semibold text-neutral-900 leading-tight">
          Erkannte Dächer <span className="text-neutral-500">({detected.length})</span>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="mt-1 text-[11px] text-indigo-600 hover:text-indigo-700 cursor-pointer"
        >
          {allChecked ? 'Alle abwählen' : 'Alle auswählen'}
        </button>

        {/* mini summary */}
        {totalSel > 0 && (
          <div className="mt-1 text-[11px] text-neutral-600">
            Ausgewählt: <span className="tabular-nums">{totalSel}</span>
            {Number.isFinite(totalArea) && (
              <> &middot; Fläche ~ <span className="tabular-nums">{(totalArea / 1).toFixed(1)}</span> m²</>
            )}
          </div>
        )}
      </div>

      {/* Lista compatta, ottimizzata per ~240px */}
      <div className="max-h-56 overflow-y-auto pr-1 space-y-1.5">
        {rows.map(r => (
          <label
            key={r.id}
            className={[
              'block rounded-md px-2 py-1.5 cursor-pointer',
              'hover:bg-neutral-50 border border-transparent hover:border-neutral-200',
            ].join(' ')}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggleOne(r.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* badge area a destra, tabular per allineare */}
                  <div className="truncate text-neutral-800">
                    {r.tiltDeg != null ? `${r.tiltDeg}°` : '–'} / {r.azimuthDeg != null ? `${r.azimuthDeg}°` : '–'}
                  </div>
                  <div className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] tabular-nums text-neutral-700">
                    {r.area != null ? `${r.area.toFixed(1)} m²` : '—'}
                  </div>
                </div>
                <div className="text-[11px] text-neutral-500">
                  Neigung / Ausrichtung
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      {/* CTA in colonna */}
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={importSelected}
          disabled={selected.size === 0}
          className={[
            'w-full rounded-md px-3 py-1.5 text-[12px] font-medium',
            'border border-neutral-900 bg-neutral-900 text-white',
            'disabled:cursor-not-allowed cursor-pointer disabled:border-neutral-200 disabled:bg-neutral-200',
          ].join(' ')}
          title="Ausgewählte Flächen als Ebenen hinzufügen"
        >
          In Ebenen importieren
        </button>

        <button
          type="button"
          onClick={() => clearDet()}
          className="w-full cursor-pointer rounded-md border px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50"
          title="Ergebnisliste verwerfen"
        >
          Liste verwerfen
        </button>
      </div>
    </section>
  );
}
