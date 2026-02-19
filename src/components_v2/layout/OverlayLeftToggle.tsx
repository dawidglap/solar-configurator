// src/components_v2/layout/OverlayLeftToggle.tsx
"use client";

import type { CSSProperties } from "react";
import { PanelLeft } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function OverlayLeftToggle() {
  const open = usePlannerV2Store((s) => s.ui.leftPanelOpen);
  const toggle = usePlannerV2Store((s) => s.toggleLeftPanelOpen);
  const step = usePlannerV2Store((s) => s.step);
  const count = usePlannerV2Store((s) => s.layers.length);

  // Se il pannello Ebenen è aperto, nascondi il toggle
  if (open) return null;

  const isPrimary = step === "building";

  const baseBtn =
    "pointer-events-auto fixed z-[320] h-9 px-3 rounded-full border shadow " +
    "inline-flex items-center gap-2 text-sm transition-colors";
  const filled =
    "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800";
  const outline =
    "bg-white/90 text-neutral-800 border-neutral-200 hover:bg-white";

  const style: CSSProperties = {
    top: "calc(var(--tb, 48px) + 48px)",
    right: "8px", // vicino al bordo destro quando il pannello è chiuso
  };

  return (
    <button
      type="button"
      title="Ebenen"
      aria-pressed={false}
      aria-controls="right-layers-panel"
      onClick={toggle}
      className={[baseBtn, isPrimary ? filled : outline].join(" ")}
      style={style}
    >
      <PanelLeft className="w-4 h-4" />
      <span className="hidden sm:inline">Ebenen</span>
      {count > 0 && (
        <span className="ml-1 rounded-full text-[11px] px-2 py-0.5 bg-white/20 border border-white/25">
          {count}
        </span>
      )}
    </button>
  );
}
