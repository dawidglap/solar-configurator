'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

function areaM2(points: {x:number;y:number}[], mpp?: number) {
  if (!mpp || points.length < 3) return undefined;
  let a = 0;
  for (let i=0, j=points.length-1; i<points.length; j=i++) {
    a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  const px2 = Math.abs(a / 2);
  return px2 * mpp * mpp;
}

export default function DetectedRoofsImport() {
  const snapshot = usePlannerV2Store(s => s.snapshot);
  const detected = usePlannerV2Store(s => s.detectedRoofs);
  const addRoof   = usePlannerV2Store(s => s.addRoof);
  const clearDet  = usePlannerV2Store(s => s.clearDetectedRoofs);
  const select    = usePlannerV2Store(s => s.select);
  const layers    = usePlannerV2Store(s => s.layers);

  // selezionate (default: tutte)
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

    // continuiamo la numerazione con lettere dopo i layer esistenti
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

  return (
    <section className="mt-4 rounded-lg border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-neutral-900">
          Gefundene Dachflächen <span className="text-neutral-500">({detected.length})</span>
        </h3>
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-neutral-50"
        >
          {allChecked ? 'Alle abwählen' : 'Alle auswählen'}
        </button>
      </div>

      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {rows.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-50"
          >
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggleOne(r.id)}
                className="h-3.5 w-3.5"
              />
              <span className="text-[12px] text-neutral-800">
                {r.tiltDeg != null ? `${r.tiltDeg}°` : '–'} / {r.azimuthDeg != null ? `${r.azimuthDeg}°` : '–'}
                <span className="text-neutral-500"> (Neigung / Ausrichtung)</span>
              </span>
            </span>
            <span className="text-[12px] tabular-nums text-neutral-600">
              {r.area != null ? `${r.area.toFixed(1)} m²` : ''}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => clearDet()}
          className="rounded-md border px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          title="Ergebnisliste verwerfen"
        >
          Verwerfen
        </button>
        <button
          type="button"
          onClick={importSelected}
          disabled={selected.size === 0}
          className="rounded-md border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-xs text-white disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200"
          title="Ausgewählte Flächen als Ebenen hinzufügen"
        >
          In Ebenen importieren
        </button>
      </div>
    </section>
  );
}
