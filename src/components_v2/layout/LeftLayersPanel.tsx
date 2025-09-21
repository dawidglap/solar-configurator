// src/components_v2/layout/LeftLayersPanel.tsx
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';

export default function LeftLayersPanel() {
  const layers      = usePlannerV2Store((s) => s.layers);
  const selectedId  = usePlannerV2Store((s) => s.selectedId);
  const select      = usePlannerV2Store((s) => s.select);
  const del         = usePlannerV2Store((s) => s.deleteLayer);
  const mpp         = usePlannerV2Store((s) => s.snapshot.mppImage);
  const detected    = usePlannerV2Store((s) => s.detectedRoofs);

  return (
    <div className="flex  w-full flex-col">
      {/* Header compatto e sticky */}
      <div className="sticky top-0 z-10 border-b bg-white/80 px-2 py-2 backdrop-blur">
        <h3 className="text-xs font-semibold tracking-tight">Ebenen</h3>
      </div>

      {/* Body + Erkannte Dächer */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {detected?.length > 0 && (
          <section className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
            {/* <h4 className="mb-1 text-[11px] font-semibold text-neutral-900">Erkannte Dächer</h4> */}
            <DetectedRoofsImport />
          </section>
        )}

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
                      'flex items-center justify-between rounded-md border px-2 py-1 text-xs',
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

                    {/* Badge area (fuori mappa) */}
                    <RoofAreaInfo points={l.points} mpp={mpp} />

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
    </div>
  );
}
