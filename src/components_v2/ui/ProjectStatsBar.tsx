// src/components_v2/ui/ProjectStatsBar.tsx
"use client";

import React, { useMemo } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";

function fmt(
  n: number,
  {
    min = 0,
    max = 0,
    locale = "de-CH",
  }: { min?: number; max?: number; locale?: string } = {},
) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
}

export default function ProjectStatsBar() {
  const panels = usePlannerV2Store((s) => s.panels);
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage);
  const selSpec = usePlannerV2Store((s) => s.getSelectedPanel());

  const { count, areaM2, kwp } = useMemo(() => {
    const count = panels.length;
    let areaM2 = 0;
    if (mpp) for (const p of panels) areaM2 += p.wPx * p.hPx * (mpp * mpp);
    const kwp = selSpec ? (selSpec.wp / 1000) * count : 0;
    return { count, areaM2, kwp };
  }, [panels, mpp, selSpec]);

  return (
    <div
      className="
        inline-flex items-center h-8 pl-4
        border-l border-white/80
        px-2 select-none
      "
      aria-live="polite"
    >
      <div
        className="
          text-[13px] sm:text-[14px] font-medium tracking-tight
          text-neutral-100
        "
      >
        {/* Count */}
        <span className="text-neutral-100">{fmt(count)}</span>
        <span className="mx-2 text-neutral-300">Module</span>
        <span className="me-2 text-white">|</span>

        {/* kWp */}
        <span className="text-neutral-100">{fmt(kwp, { min: 2, max: 2 })}</span>
        <span className="ml-1 text-neutral-300">kWp</span>
        <span className="me-2 ms-2 text-white">|</span>

        {/* m² */}
        <span className="text-neutral-100">{fmt(Math.round(areaM2))}</span>
        <span className="ml-1 text-neutral-300">m²</span>
      </div>
    </div>
  );
}
