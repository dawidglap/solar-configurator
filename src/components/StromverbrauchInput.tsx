"use client";

import { useEffect, useRef } from "react";
import { BatteryCharging } from "lucide-react";
import { motion } from "framer-motion";

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
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNext]);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-xl flex flex-col items-center px-6"
      >
        {/* 🟢 Domanda in pill */}
        <div className="mb-10 px-6 py-2 rounded-full bg-white/20 backdrop-blur-xl border border-white/30 text-white text-xl font-semibold shadow">
          Stromverbrauch pro Jahr?
        </div>

        {/* 🔋 Card risposta */}
        <div className="w-full rounded-3xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-xl p-8 flex flex-col items-center gap-6">
          <BatteryCharging className="w-14 h-14 text-white opacity-90" />

          <div className="flex items-center gap-3 bg-white/80 text-black px-6 py-4 rounded-full shadow-inner">
            <input
              ref={inputRef}
              type="number"
              placeholder="z.B. 10000"
              className="bg-transparent outline-none w-28 text-right text-2xl font-bold tracking-wide"
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="text-lg font-semibold">kWh</span>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onNext}
            className="cursor-pointer mt-2 bg-white/80 hover:bg-white text-black font-semibold text-lg px-8 py-3 rounded-full shadow-lg"
          >
            Weiter
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
