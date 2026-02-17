// src/components_v2/layout/OverlayProgressStepper.tsx
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import {
  User,
  Home,
  ListChecks,
  BadgeCheck,
  Map,
  FileText,
} from "lucide-react";

type StoreKey =
  | "profile"
  | "ist"
  | "building"
  | "modules"
  | "strings"
  | "parts";

type UiStep =
  | {
      key: "profile";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | { key: "ist"; label: string; short: string; Icon: any; clickable: boolean }
  | {
      key: "building";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | {
      key: "modules";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | {
      key: "parts";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | {
      key: "report";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | {
      key: "offer";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    };

const UI_STEPS: UiStep[] = [
  {
    key: "profile",
    label: "Profil",
    short: "Profil",
    Icon: User,
    clickable: true,
  },
  {
    key: "ist",
    label: "IST-Situation",
    short: "IST",
    Icon: Map,
    clickable: true,
  },
  {
    key: "building",
    label: "Gebäudeplanung",
    short: "Gebäude",
    Icon: Home,
    clickable: true,
  },
  {
    key: "modules",
    label: "Modulplanung",
    short: "Module",
    Icon: Home,
    clickable: true,
  },
  {
    key: "parts",
    label: "Stückliste",
    short: "Stückliste",
    Icon: ListChecks,
    clickable: true,
  },
  {
    key: "report",
    label: "Bericht",
    short: "Bericht",
    Icon: FileText,
    clickable: true,
  },
  {
    key: "offer",
    label: "Angebot",
    short: "Angebot",
    Icon: BadgeCheck,
    clickable: true,
  },
];

const ACTIVE = "#6ce5e8";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function OverlayProgressStepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        UI_STEPS.findIndex((s) => s.key === (step as any)),
      ),
    [step],
  );

  // topbar height -> css var --tb
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.offsetHeight || 56;
      document.body.style.setProperty("--tb", `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.removeProperty("--tb");
    };
  }, []);

  // pill positioning
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });

  const recomputePill = () => {
    const track = trackRef.current;
    const btn = btnRefs.current[activeIndex];
    if (!track || !btn) return;

    const t = track.getBoundingClientRect();
    const b = btn.getBoundingClientRect();

    // padding inside track for nicer pill
    const inset = 6; // px
    const left = clamp(b.left - t.left + inset, 0, t.width);
    const width = clamp(b.width - inset * 2, 24, t.width);

    setPill({ left, width, ready: true });
  };

  useLayoutEffect(() => {
    recomputePill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  useEffect(() => {
    recomputePill();

    const onResize = () => recomputePill();
    window.addEventListener("resize", onResize);

    const track = trackRef.current;
    const ro = track ? new ResizeObserver(onResize) : null;
    if (track && ro) ro.observe(track);

    return () => {
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={barRef}
      className="fixed left-0 right-0 top-0 z-[200] planner-topbar text-white"
      style={{
        paddingLeft: "var(--sb, 64px)",
        // iOS-like glass (trasparente + blur)
        // background:
        //   "linear-gradient(180deg, rgba(58, 78, 92, 0.68) 0%, rgba(44, 62, 74, 0.54) 100%)",
      }}
    >
      {/* highlight top edge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" />

      <div className="relative flex h-14 w-full items-center px-4 bg-black/50 backdrop-blur-md border-t border-l  border-white/10  rounded-tl-2xl rounded-bl-2xl">
        <nav aria-label="Wizard progress" className="w-full">
          {/* TRACK */}
          <div
            ref={trackRef}
            className="relative mx-auto w-full"
            style={{ maxWidth: 1400 }}
          >
            {/* MOVING PILL (glass) */}
            <div
              aria-hidden
              className="absolute top-1/2 -translate-y-1/2 rounded-full transition-[left,width,opacity] duration-300 ease-out"
              style={{
                left: pill.left,
                width: pill.width,
                height: 34,
                opacity: pill.ready ? 1 : 0,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%)",
                border: "1px solid rgba(108,229,232,0.35)",
                boxShadow:
                  "0 10px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              {/* soft cyan glow */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow: "0 0 26px rgba(108,229,232,0.18)",
                }}
              />
            </div>

            {/* ITEMS */}
            <ol className="relative flex w-full items-center justify-evenly gap-2">
              {UI_STEPS.map((s, i) => {
                const isActive = i === activeIndex;

                const onClick = () => {
                  if (!s.clickable) return;
                  setStep(s.key as StoreKey);
                };

                const base =
                  "relative z-[1] w-full px-2 py-2 text-center transition-colors select-none";
                const labelCls =
                  "text-[13px] md:text-[13px] font-medium tracking-wide whitespace-nowrap";
                const activeCls = "text-[var(--active)]";
                const idleCls = "text-white/85 hover:text-white";
                const disabledCls = "text-white/45 cursor-default";

                return (
                  <li key={s.key} className="flex-1 min-w-0">
                    {s.clickable ? (
                      <button
                        ref={(el) => {
                          btnRefs.current[i] = el;
                        }}
                        type="button"
                        onClick={onClick}
                        aria-current={isActive ? "step" : undefined}
                        className={`${base} focus:outline-none`}
                        style={{ ["--active" as any]: ACTIVE }}
                        title={s.label}
                      >
                        <span
                          className={`${labelCls} ${isActive ? activeCls : idleCls}`}
                        >
                          {s.label}
                        </span>
                      </button>
                    ) : (
                      <div className={`${base} ${disabledCls}`} title={s.label}>
                        <span className={labelCls}>{s.label}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </nav>
      </div>
    </div>
  );
}
