'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { LayoutGrid, Zap, Maximize2 } from 'lucide-react';
import { usePlannerV2Store } from '../state/plannerV2Store';

/** Hook counter animato (numeri fluidi) */
function useAnimatedNumber(value: number, duration = 0.6) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const unsub = mv.on('change', (v) => setDisplay(v));
    return () => unsub();
  }, [mv]);

  useEffect(() => {
    // anima dal valore precedente a quello nuovo
    animate(mv, value, { duration, ease: 'easeOut' });
    prevRef.current = value;
  }, [value, mv, duration]);

  return display;
}

/** Span con numero formattato e animato */
function AnimatedNumber({
  value,
  minFrac = 0,
  maxFrac = 0,
  className,
  locale = 'de-CH',
}: {
  value: number;
  minFrac?: number;
  maxFrac?: number;
  className?: string;
  locale?: string;
}) {
  const animated = useAnimatedNumber(value);
  const formatted = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: minFrac,
        maximumFractionDigits: maxFrac,
      }).format(animated),
    [animated, locale, minFrac, maxFrac]
  );

  // micro-pulse quando il numero cresce
  const [last, setLast] = useState(value);
  const grew = value > last;
  useEffect(() => setLast(value), [value]);

  return (
    <motion.span
      className={className}
      animate={grew ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {formatted}
    </motion.span>
  );
}

export default function ProjectStatsBar() {
  const panels  = usePlannerV2Store((s) => s.panels);
  const mpp     = usePlannerV2Store((s) => s.snapshot.mppImage);
  const selSpec = usePlannerV2Store((s) => s.getSelectedPanel());

  // Totali globali (tutte le falde)
  const { totalCount, totalAreaM2, totalKwp } = useMemo(() => {
    const count = panels.length;
    let area = 0;
    if (mpp) {
      for (const p of panels) area += p.wPx * p.hPx * (mpp * mpp);
    }
    const kwp = selSpec ? (selSpec.wp / 1000) * count : 0;
    return { totalCount: count, totalAreaM2: area, totalKwp: kwp };
  }, [panels, mpp, selSpec]);

  // Mostriamo sempre la barra (anche con 0) per vedere il “counter” crescere.
  const visible = true;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="project-stats-bar"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          className="fixed inset-x-0 bottom-4 z-[350] flex justify-center pointer-events-none"
          aria-live="polite"
        >
          <div
            className="
              pointer-events-auto
              flex items-center gap-6 sm:gap-8
              rounded-full border border-neutral-200
              bg-white/90 backdrop-blur px-4 sm:px-6 py-2.5
              shadow-xl
              max-w-[96vw]
            "
          >
            {/* Moduli */}
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-neutral-700" aria-hidden />
              <span className="text-[13px] sm:text-[14px] font-semibold tracking-tight">
                <AnimatedNumber value={totalCount} minFrac={0} maxFrac={0} />{' '}
                <span className="font-normal text-neutral-700">Module</span>
              </span>
            </div>

            <span className="text-neutral-300">·</span>

            {/* kWp */}
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-neutral-700" aria-hidden />
              <span className="text-[13px] sm:text-[14px] font-semibold tracking-tight">
                <AnimatedNumber value={totalKwp} minFrac={2} maxFrac={2} />{' '}
                <span className="font-normal text-neutral-700">kWp</span>
              </span>
            </div>

            <span className="text-neutral-300">·</span>

            {/* Area */}
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4 text-neutral-700" aria-hidden />
              <span className="text-[13px] sm:text-[14px] font-semibold tracking-tight">
                <AnimatedNumber value={totalAreaM2} minFrac={1} maxFrac={1} />{' '}
                <span className="font-normal text-neutral-700">m²</span>
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
