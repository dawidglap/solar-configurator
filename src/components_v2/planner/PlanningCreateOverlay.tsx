"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const MESSAGES = [
  {
    title: "Neue Planung wird vorbereitet",
    desc: "Wir legen die Basisdaten an und synchronisieren alles.",
  },
  {
    title: "Profil wird initialisiert",
    desc: "Formulare, Defaults und Validierung werden geladen.",
  },
  {
    title: "Projektstruktur wird erstellt",
    desc: "Schritte, Status und Versionen werden gesetzt.",
  },
  {
    title: "Fast fertig",
    desc: "Wir öffnen gleich den Planer – einen Moment noch.",
  },
] as const;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function PlanningCreateOverlay({
  open,
  startedAt,
}: {
  open: boolean;
  startedAt: number | null; // Date.now() quando parte
}) {
  const [idx, setIdx] = useState(0);

  // rotazione testi
  useEffect(() => {
    if (!open) return;
    setIdx(0);
    const t = setInterval(() => {
      setIdx((p) => (p + 1) % MESSAGES.length);
    }, 1400);
    return () => clearInterval(t);
  }, [open]);

  // barra “pseudo-progress” (non finta al 100%: si ferma al 92% finché non navighi)
  const progress = useMemo(() => {
    if (!open || !startedAt) return 0;
    const elapsed = Date.now() - startedAt;

    // curva morbida → si stabilizza verso 0.92
    const p = 1 - Math.exp(-elapsed / 1200);
    return clamp(p * 0.92, 0.06, 0.92);
  }, [open, startedAt, idx]); // idx per rerender regolare

  const msg = MESSAGES[idx];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop “premium” */}
          <div className="absolute inset-0 bg-black/55" />
          <div className="absolute inset-0 backdrop-blur-[10px]" />

          {/* Glow + texture */}
          <div className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-400/15 blur-[90px]" />
          <div className="absolute bottom-[-180px] left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-sky-400/10 blur-[110px]" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(#ffffff_1px,transparent_1px)] [background-size:18px_18px]" />

          {/* Card */}
          <motion.div
            className="relative w-[92vw] max-w-[520px] rounded-3xl border border-white/15 bg-white/10 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
          >
            {/* Header */}
            <div className="flex items-start gap-4">
              {/* Orb spinner */}
              <div className="relative mt-0.5 h-12 w-12 shrink-0">
                <motion.div
                  className="absolute inset-0 rounded-full border border-white/20"
                  animate={{ rotate: 360 }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.4,
                    ease: "linear",
                  }}
                />
                <motion.div
                  className="absolute inset-[6px] rounded-full bg-white/10"
                  animate={{ opacity: [0.35, 0.8, 0.35] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    ease: "easeInOut",
                  }}
                />
                <motion.div
                  className="absolute inset-[10px] rounded-full bg-emerald-400/35 blur-[1px]"
                  animate={{ scale: [0.98, 1.06, 0.98] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.15,
                    ease: "easeInOut",
                  }}
                />
              </div>

              <div className="min-w-0">
                <AnimatePresence mode="popLayout">
                  <motion.h3
                    key={msg.title}
                    className="text-base md:text-lg font-semibold text-white/95"
                    initial={{ y: 6, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -6, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {msg.title}
                  </motion.h3>
                </AnimatePresence>

                <AnimatePresence mode="popLayout">
                  <motion.p
                    key={msg.desc}
                    className="mt-1 text-sm text-white/70 leading-relaxed"
                    initial={{ y: 6, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -6, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {msg.desc}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-[11px] text-white/55">
                <span>SOLA Planner</span>
                <span className="tabular-nums">
                  {Math.round(progress * 100)}%
                </span>
              </div>

              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-white/70"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                  animate={{ width: `${Math.round(progress * 100)}%` }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                />
              </div>

              {/* Micro hint */}
              <motion.div
                className="mt-3 text-[11px] text-white/45"
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.6,
                  ease: "easeInOut",
                }}
              >
                Bitte schließen Sie dieses Fenster nicht – wir speichern im
                Hintergrund.
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
