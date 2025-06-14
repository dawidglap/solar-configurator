"use client";

import { useEffect, useRef, useState } from "react";
import { Car } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ElektroautoFrage({
  onNext,
}: {
  onNext: (antwort: { elektro: boolean; auto?: string }) => void;
}) {
  const [antwort, setAntwort] = useState<"ja" | "nein" | null>(null);
  const [welchesAuto, setWelchesAuto] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (antwort === "ja") onNext({ elektro: true, auto: welchesAuto });
        else if (antwort === "nein") onNext({ elektro: false });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [antwort, welchesAuto, onNext]);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-xl flex flex-col items-center px-6"
      >
        {/* ✅ Domanda in pill separata sopra */}
        <div className="mb-10 px-6 py-2 rounded-full bg-white/20 backdrop-blur-xl border border-white/30 text-white text-xl font-semibold shadow">
          Elektroauto ein Thema?
        </div>

        {/* ✅ Card con risposte */}
        <div className="w-full rounded-3xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-xl p-8 flex flex-col items-center gap-6">
          <Car className="w-14 h-14 text-white opacity-90" />

          {/* Ja / Nein */}
          <div className="flex gap-10 text-white text-lg font-semibold">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="elektro"
                checked={antwort === "ja"}
                onChange={() => setAntwort("ja")}
                className="accent-white w-5 h-5"
              />
              Ja
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="elektro"
                checked={antwort === "nein"}
                onChange={() => setAntwort("nein")}
                className="accent-white w-5 h-5"
              />
              Nein
            </label>
          </div>

          {/* Input: welches Auto? */}
          <AnimatePresence>
            {antwort === "ja" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="w-full flex flex-col items-center gap-2 overflow-hidden"
              >
                <label className="text-white font-semibold text-base">Welches Auto?</label>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="z.B. Tesla Model 3"
                  className="bg-white/80 text-black text-lg font-semibold px-6 py-3 rounded-full shadow-inner outline-none w-full text-center"
                  value={welchesAuto}
                  onChange={(e) => setWelchesAuto(e.target.value)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottone Weiter */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (antwort === "ja") onNext({ elektro: true, auto: welchesAuto });
              else if (antwort === "nein") onNext({ elektro: false });
            }}
            disabled={!antwort}
            className="cursor-pointer mt-2 bg-white/80 hover:bg-white text-black font-semibold text-lg px-8 py-3 rounded-full shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Weiter
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
