'use client';

import TopToolbar from './TopToolbar';

/**
 * Wrapper “solo UI” che posiziona la TopToolbar come overlay sopra la mappa.
 * Non tocca la logica interna di TopToolbar: la riutilizza 1:1.
 */
export default function OverlayTopToolbar() {
  return (
    <div
      className="
        pointer-events-none
        absolute top-2 left-1/2 -translate-x-1/2 z-[110]
        w-[calc(100%-16px)] max-w-[1100px]
        px-2
      "
    >
      <div
        className="
          pointer-events-auto
          rounded-xl border border-neutral-200
          bg-white/85 backdrop-blur
          shadow-sm
        "
      >
        {/* Riutilizziamo la TopToolbar esistente, senza modificarne la logica */}
        <TopToolbar />
      </div>
    </div>
  );
}
