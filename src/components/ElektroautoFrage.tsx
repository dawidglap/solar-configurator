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

  // Gestione ENTER
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
    <motion.div
      className="fixed inset-0 z-[999] bg-black/40 backdrop-blur-sm flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -50, opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="w-[90%] max-w-md rounded-3xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-2xl p-6 flex flex-col items-center gap-6"
      >
        {/* Icona + domanda */}
        <div className="flex items-center gap-4">
          <Car className="w-12 h-12 text-white" />
          <p className="text-white font-semibold text-lg">Elektroauto ein Thema?</p>
        </div>

        {/* Radio buttons */}
        <div className="flex gap-8">
          <label className="flex items-center gap-2 text-white font-semibold cursor-pointer">
            <input
              type="radio"
              name="elektro"
              checked={antwort === "ja"}
              onChange={() => setAntwort("ja")}
              className="accent-white w-5 h-5"
            />
            Ja
          </label>
          <label className="flex items-center gap-2 text-white font-semibold cursor-pointer">
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

        {/* Input se "Ja" */}
        <AnimatePresence>
          {antwort === "ja" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full flex flex-col items-center gap-2 overflow-hidden"
            >
              <label className="text-white font-semibold text-sm">Welches Auto?</label>
              <input
                ref={inputRef}
                type="text"
                className="bg-white/90 text-black font-semibold px-4 py-2 rounded-full shadow-inner outline-none w-full"
                value={welchesAuto}
                onChange={(e) => setWelchesAuto(e.target.value)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottone Weiter */}
        <button
          onClick={() => {
            if (antwort === "ja") onNext({ elektro: true, auto: welchesAuto });
            else if (antwort === "nein") onNext({ elektro: false });
          }}
          className="mt-4 bg-white/90 hover:bg-white text-black font-semibold px-6 py-2 rounded-full shadow"
          disabled={!antwort}
        >
          Weiter
        </button>
      </motion.div>
    </motion.div>
  );
}
