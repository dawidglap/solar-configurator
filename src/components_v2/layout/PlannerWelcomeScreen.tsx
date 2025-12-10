"use client";

import Image from "next/image";
import { Search, ChevronRight } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";

type Props = {
  onStartNew: () => void;
};

export default function PlannerWelcomeScreen({ onStartNew }: Props) {
  const resetForNewAddress = usePlannerV2Store((s) => s.resetForNewAddress);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const handleStartNew = () => {
    resetForNewAddress({});
    setStep("profile");
    onStartNew();
  };

  return (
    <div
      className="relative flex h-screen w-full items-center justify-center px-4 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("/images/hero.webp")` }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* Contenuto */}
      <div className="relative z-10 flex flex-col items-center gap-10 md:gap-14">
        {/* LOGO */}
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/images/logo.png"
            width={220}
            height={220}
            alt="Sola logo"
            className="opacity-95 drop-shadow-xl"
            priority
          />
        </div>

        {/* BOTTONI */}
        <div className="flex flex-col md:flex-row gap-5 md:gap-8 w-full max-w-3xl justify-center">
          {/* EXISTING PROJECT */}
          <button
            type="button"
            className="group flex-1 max-w-md mx-auto flex items-center gap-3 rounded-full border border-white/40 bg-white/5 backdrop-blur-md px-6 py-2.5 text-sm md:text-base text-white/90 shadow-[0_0_20px_rgba(0,0,0,0.35)] hover:bg-white/10 transition"
          >
            <span className="flex-1 text-left whitespace-nowrap">
              Bestehende Planung öffnen
            </span>

            {/* Circle icon */}
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/10 group-hover:bg-white/20 transition">
              <Search className="h-4 w-4" />
            </span>
          </button>

          {/* NEW PROJECT */}
          <button
            type="button"
            onClick={handleStartNew}
            className="group flex-1 max-w-md mx-auto flex items-center gap-3 rounded-full border border-emerald-400/80 bg-emerald-500/10 backdrop-blur-md px-6 py-2.5 text-sm md:text-base text-emerald-100 shadow-[0_0_20px_rgba(0,0,0,0.35)] hover:bg-emerald-500/20 transition"
          >
            <span className="flex-1 text-left whitespace-nowrap font-medium">
              Neue Planung starten
            </span>

            {/* Circle icon */}
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-300/80 bg-emerald-400/40 group-hover:bg-emerald-300/70 transition">
              <ChevronRight className="h-4 w-4 text-emerald-900" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
