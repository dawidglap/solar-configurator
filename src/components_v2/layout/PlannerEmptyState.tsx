// src/components_v2/layout/PlannerEmptyState.tsx
"use client";

import Image from "next/image";

export default function PlannerEmptyState() {
  return (
    <div className="absolute inset-0 z-0">
      {/* background immagine con fade-top bianco */}
      <div className="absolute inset-0">
        <Image
          src="/hero-helionic.jpeg"
          alt=""
          fill
          priority
          className="object-cover object-center"
        />
        {/* <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" /> */}
      </div>

      {/* CTA con glow/pulse */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center mt-24 sm:mt-28">
        <div
          className="relative"
          // Sposta la pill di metà della larghezza del pannello proprietà a sinistra.
          // Fallback: 280px → shift 140px.
          style={{ transform: "translateX(calc(var(--propW, 280px) / 2))" }}
        >
          {/* glow morbido dietro al pill */}
          <div className="absolute -inset-1 rounded-full bg-primary/30 blur-md animate-pulse" />
          {/* pill */}
          <div className="glass-panel-elevated relative z-10 flex items-center gap-2 rounded-full px-5 py-2 text-sm shadow-xl ring-1 ring-primary/25">
            <span className="text-primary text-base leading-none">↖</span>
            <span className="font-medium text-foreground">
              Um zu starten, gib links oben deine Adresse ein
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
