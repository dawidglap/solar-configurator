"use client";

import { useEffect, useRef } from "react";
import { BatteryCharging } from "lucide-react";

export default function StromverbrauchInput({
  value,
  onChange,
  onNext,
}: {
  value: number;
  onChange: (val: number) => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onNext(); // passa allo step successivo
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNext]);

  return (
    <div className="fixed inset-0 z-[999] bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[90%] max-w-md rounded-3xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-2xl p-6 flex flex-col items-center gap-6">
        {/* Icona batteria + domanda */}
        <div className="flex items-center gap-4">
          <BatteryCharging className="w-12 h-12 text-white" />
          <p className="text-white font-semibold text-lg">
            Stromverbrauch pro Jahr?
          </p>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 bg-white/90 text-black px-4 py-2 rounded-full shadow-inner">
          <input
            ref={inputRef}
            type="number"
            className="bg-transparent outline-none w-24 text-right font-bold"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="text-sm font-semibold">kWh</span>
        </div>

        {/* Bottone Weiter */}
        <button
          onClick={onNext}
          className="mt-2 bg-white/90 hover:bg-white text-black font-semibold px-6 py-2 rounded-full shadow"
        >
          Weiter
        </button>
      </div>
    </div>
  );
}
