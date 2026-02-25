// src/components_v2/layout/TopToolbar/OrientationToggle.tsx
"use client";

import React, { useCallback, useRef, useState, useEffect } from "react";
import { usePlannerV2Store } from "@/components_v2/state/plannerV2Store";
import { history as plannerHistory } from "@/components_v2/state/history";
import { RectangleVertical, RectangleHorizontal } from "lucide-react";
import { createPortal } from "react-dom";

type Orientation = "portrait" | "landscape";

// ───────────────────── Tooltip (coerente con TopToolbar) ─────────────────────
type TooltipPos = { x: number; y: number };

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="
      inline-flex h-5 min-w-[20px] items-center justify-center
      rounded-[6px] border border-neutral-700/70 bg-neutral-800
      px-1 text-[10px] font-medium leading-none text-white/90
      shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_1px_6px_rgba(0,0,0,0.4)]
    "
    >
      {children}
    </span>
  );
}

function PortalTooltip({
  visible,
  pos,
  label,
  keys,
}: {
  visible: boolean;
  pos: TooltipPos | null;
  label: string;
  keys?: (string | React.ReactNode)[];
}) {
  if (typeof window === "undefined" || !visible || !pos) return null;

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, 0)",
        zIndex: 100000,
        pointerEvents: "none",
      }}
      className="rounded-md border border-neutral-800 bg-neutral-900/98 px-2.5 py-2 text-xs text-white shadow-xl whitespace-nowrap"
    >
      <div className="font-medium">{label}</div>
      {keys?.length ? (
        <div className="mt-1 flex items-center justify-center gap-1">
          {keys.map((k, i) => (
            <Keycap key={i}>{k}</Keycap>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

type AnyRef<T extends HTMLElement> =
  | React.RefObject<T>
  | React.MutableRefObject<T | null>;

function useBottomTooltip<T extends HTMLElement>(triggerRef: AnyRef<T>) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);

  const compute = () => {
    const el = triggerRef.current as T | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
  };

  const show = () => {
    compute();
    setVisible(true);
  };
  const hide = () => setVisible(false);

  useEffect(() => {
    if (!visible) return;
    const onScroll = () => compute();
    const onResize = () => compute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible]);

  return { visible, pos, show, hide };
}
// ───────────────────────────────────────────────────────────────

export default function OrientationToggle({
  onChange,
}: {
  /** Callback opzionale: viene chiamata subito dopo l'update nello store */
  onChange?: (next: Orientation) => void;
}) {
  const orientation = usePlannerV2Store(
    (s) => s.modules.orientation as Orientation,
  );

  const setOrientation = useCallback(
    (o: Orientation) => {
      const st: any = usePlannerV2Store.getState();
      plannerHistory?.push?.(`orientation: ${o}`);

      // aggiorna lo store (compatibile con diverse versioni dello store)
      if (typeof st.setModulesOrientation === "function") {
        st.setModulesOrientation(o);
      } else if (typeof st.setModules === "function") {
        st.setModules({ ...st.modules, orientation: o });
      } else if (typeof st.updateModules === "function") {
        st.updateModules({ orientation: o });
      } else {
        (usePlannerV2Store as any).setState(
          (prev: any) => ({
            ...prev,
            modules: { ...prev.modules, orientation: o },
          }),
          false,
          "modules.orientation",
        );
      }

      onChange?.(o);
    },
    [onChange],
  );

  // Bottoni dark + testo
  const baseBtn =
    "h-8 inline-flex items-center gap-1  px-2 text-[10px] uppercase tracking-wide font-semibold transition";

  // tooltip hooks per i due bottoni
  const portraitRef = useRef<HTMLButtonElement>(null);
  const landscapeRef = useRef<HTMLButtonElement>(null);
  const portraitTip = useBottomTooltip(portraitRef);
  const landscapeTip = useBottomTooltip(landscapeRef);

  return (
    <div
      className="ml-1 inline-flex items-center gap-0 rounded-full border border-white/80 bg-transparent  text-white"
      aria-label="Ausrichtung"
    >
      {/* Portrait */}
      <>
        <button
          ref={portraitRef}
          type="button"
          onClick={() => setOrientation("portrait")}
          onMouseEnter={portraitTip.show}
          onMouseLeave={portraitTip.hide}
          onFocus={portraitTip.show}
          onBlur={portraitTip.hide}
          className={`${baseBtn} ${
            orientation === "portrait"
              ? "bg-white text-black rounded-l-full"
              : "text-neutral-200 hover:bg-neutral-600  rounded-l-full"
          }`}
          aria-label="Portrait (vertikal)"
        >
          <RectangleVertical className="h-4 w-4" />
          <span>VERTICAL</span>
        </button>
        <PortalTooltip
          visible={portraitTip.visible}
          pos={portraitTip.pos}
          label="Portrait (vertikal)"
        />
      </>

      {/* Landscape */}
      <>
        <button
          ref={landscapeRef}
          type="button"
          onClick={() => setOrientation("landscape")}
          onMouseEnter={landscapeTip.show}
          onMouseLeave={landscapeTip.hide}
          onFocus={landscapeTip.show}
          onBlur={landscapeTip.hide}
          className={`${baseBtn} ${
            orientation === "landscape"
              ? "bg-white text-black rounded-r-full"
              : "text-neutral-200 hover:bg-neutral-600 rounded-r-full"
          }`}
          aria-label="Landscape (horizontal)"
        >
          <RectangleHorizontal className="h-4 w-4" />
          <span>HORIZONTAL</span>
        </button>
        <PortalTooltip
          visible={landscapeTip.visible}
          pos={landscapeTip.pos}
          label="Landscape (horizontal)"
        />
      </>
    </div>
  );
}
