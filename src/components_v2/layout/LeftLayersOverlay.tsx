// src/components_v2/layout/LeftLayersOverlay.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import RoofAreaInfo from "../ui/RoofAreaInfo";
import DetectedRoofsImport from "../panels/DetectedRoofsImport";

type Pt = { x: number; y: number };

/**
 * NOTE: nonostante il nome del componente, ora questo overlay “Ebenen”
 * è posizionato a DESTRA (lo spazio dove prima c’era “Eigenschaften”).
 * Si apre automaticamente entrando in Gebäudeplanung e si chiude entrando in Modulplanung.
 */
export default function LeftLayersOverlay() {
  const step = usePlannerV2Store((s) => s.step);
  const leftOpen = usePlannerV2Store((s) => s.ui.leftPanelOpen);
  const toggleLeft = usePlannerV2Store((s) => s.toggleLeftPanelOpen);
  const setUI = usePlannerV2Store((s) => s.setUI);

  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const select = usePlannerV2Store((s) => s.select);
  const del = usePlannerV2Store((s) => s.deleteLayer);
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage);
  const detected = usePlannerV2Store((s) => s.detectedRoofs);

  // Auto-open/close SOLO al cambio step (non forza in loop)
  const prevStepRef = useRef(step);
  useEffect(() => {
    const prev = prevStepRef.current;
    if (prev !== step) {
      if (step === "building") setUI({ leftPanelOpen: true });
      if (step === "modules") setUI({ leftPanelOpen: false });
      prevStepRef.current = step;
    }
  }, [step, setUI]);

  return (
    <AnimatePresence>
      {leftOpen && (
        <motion.div
          key="right-layers-panel"
          initial={{ x: 12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 12, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="fixed z-[300] pointer-events-auto"
          style={{
            // ⬇️ Dock a DESTRA, allineato alla topbar
            right: "8px",
            top: "calc(var(--tb, 48px) + 48px)",
            bottom: "12px",
            width: "min(90vw, 320px)",
          }}
        >
          <div
            className="
            w-full
            rounded-2xl border border-neutral-200
            bg-white/85 backdrop-blur-sm shadow-xl
            flex flex-col overflow-hidden
          "
          >
            {/* header */}
            <div className="top-0 z-10 border-b bg-white/80 px-3 py-2 backdrop-blur relative">
              <h3 className="text-xs font-semibold tracking-tight">
                Ebenen{layers.length ? ` (${layers.length})` : ""}
              </h3>
              <button
                onClick={toggleLeft}
                className="absolute right-2 top-1.5 rounded-full border border-neutral-200 bg-red-400 px-1 py-1 text-xs hover:bg-red-500"
                title="Schließen"
                aria-label="Schließen"
              >
                <X className="h-3.5 w-3.5 text-neutral-700 " />
              </button>
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Erkannte Dächer (se presenti) */}
              {detected?.length > 0 && (
                <section className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
                  <h4 className="mb-1 text-[11px] font-semibold text-neutral-900">
                    Erkannte Dächer
                  </h4>
                  <DetectedRoofsImport />
                </section>
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
                            "flex items-center justify-between rounded-md border px-2 py-1 text-xs",
                            active
                              ? "bg-black text-white border-black"
                              : "bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50",
                          ].join(" ")}
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
                            className={`ml-2 ${active ? "opacity-90 hover:opacity-100" : "text-neutral-400 hover:text-red-600"}`}
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
