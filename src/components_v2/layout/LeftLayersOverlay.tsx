'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';

type Pt = { x: number; y: number };

export default function LeftLayersOverlay() {
  const leftOpen   = usePlannerV2Store(s => s.ui.leftPanelOpen);
  const toggleLeft = usePlannerV2Store(s => s.toggleLeftPanelOpen);
  const layers     = usePlannerV2Store(s => s.layers);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const select     = usePlannerV2Store(s => s.select);
  const del        = usePlannerV2Store(s => s.deleteLayer);
  const mpp        = usePlannerV2Store(s => s.snapshot.mppImage);

  return (
    <AnimatePresence>
      {leftOpen && (
        <motion.div
          key="left-panel"
          initial={{ x: -16, opacity: 0 }}
          animate={{ x: 0,  opacity: 1 }}
          exit={{ x: -16,   opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="absolute left-3 top-28 bottom-3 z-[300] pointer-events-auto"
        >
          <div className="
            h-auto w-[min(90vw,320px)]
            rounded-2xl border border-neutral-200
            bg-white/85 backdrop-blur-sm shadow-xl
            flex flex-col overflow-hidden
          ">
            {/* header */}
            <div className="top-0 z-10 border-b bg-white/80 px-3 py-2 backdrop-blur relative">
              <h3 className="text-xs font-semibold tracking-tight">
                Ebenen{layers.length ? ` (${layers.length})` : ''}
              </h3>
              <button
                onClick={toggleLeft}
                className="absolute right-2 top-1.5 rounded-md border border-neutral-200 bg-white/90 px-2 py-1 text-xs hover:bg-white"
                title="Schließen"
                aria-label="Schließen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto p-3">
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
