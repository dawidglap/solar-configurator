"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lightbulb } from "lucide-react";

import { REFERENCE_EDGE_REMINDER_TEXT } from "./referenceEdgeReminder";

export default function ReferenceEdgeReminderToast({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="reference-edge-reminder"
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="pointer-events-none fixed right-0 z-[260] flex justify-center px-4"
          style={{
            left: "calc(var(--sb, 0px) + var(--propW, 312px))",
            top: "calc(var(--tb, 48px) + 48px)",
          }}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex max-w-2xl items-center gap-2 rounded-xl border border-white/15 bg-slate-950/75 px-3.5 py-2 text-xs font-medium text-slate-50 shadow-lg backdrop-blur-md">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{REFERENCE_EDGE_REMINDER_TEXT}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
