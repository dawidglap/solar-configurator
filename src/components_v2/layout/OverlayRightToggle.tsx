// src/components_v2/layout/OverlayRightToggle.tsx
'use client';

import { ChevronRight } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';

/**
 * NOTE: nonostante il nome, questo toggle apre il pannello "Eigenschaften"
 * dock a SINISTRA. È allineato a sidebar (--sb) e topbar (--tb).
 * Mostra un pill con testo per renderlo più chiaro.
 */
export default function OverlayRightToggle() {
  const rightOpen = usePlannerV2Store((s) => s.ui.rightPanelOpen);
  const setUI     = usePlannerV2Store((s) => s.setUI);

  if (rightOpen) return null;

  return (
    <button
      onClick={() => setUI({ rightPanelOpen: true })}
      title="Eigenschaften anzeigen"
      aria-label="Eigenschaften anzeigen"
      // fixed: niente clipping; z alto per stare sopra la mappa/immagine
      className="
        fixed z-[520]
        inline-flex items-center gap-2
        h-9 rounded-full
        border border-neutral-200 bg-black
        px-3 text-xs font-medium text-neutral-200
        shadow hover:bg-neutral-500 active:translate-y-[0.5px]
        focus:outline-none focus:ring-2 focus:ring-black/10
      "
      style={{
        // appena a destra della sidebar (sia chiusa che aperta)
        left: 'calc(var(--sb, 64px) -18px)',
        // sotto la topbar/stepper
        top: 'calc(var(--tb, 48px) + 48px)',
      }}
    >
      {/* freccia come in Canva style */}
      <ChevronRight className="h-4 w-4 opacity-70" />
      <span>Eigenschaften</span>
    </button>
  );
}
