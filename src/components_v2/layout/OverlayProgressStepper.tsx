// src/components_v2/layout/OverlayProgressStepper.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
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

  return (
    <div
      ref={barRef}
      className="fixed left-0 right-0 top-0 z-[200] planner-topbar text-white"
      style={{ paddingLeft: "var(--sb, 64px)" }}
    >
      {/* highlight top edge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" />

      <div className="relative flex h-14 w-full items-center px-4 bg-black/50 backdrop-blur-md border-t border-l border-[#7E8B97] rounded-tl-2xl">
        <nav aria-label="Wizard progress" className="w-full">
          <div className="relative mx-auto w-full" style={{ maxWidth: 1400 }}>
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
                  "text-[13px] md:text-[13px] font-medium tracking-wide whitespace-nowrap transition-colors";
                const activeCls = "text-[var(--active)]";
                const idleCls = "text-white/75 hover:text-white";
                const disabledCls = "text-white/45 cursor-default";

                // ✅ hover: mostra lo "short" (ma non quando è active)
                const displayText = !isActive ? s.short : s.label;

                return (
                  <li key={s.key} className="flex-1 min-w-0">
                    {s.clickable ? (
                      <button
                        type="button"
                        onClick={onClick}
                        aria-current={isActive ? "step" : undefined}
                        className={`${base} focus:outline-none group cursor-pointer`}
                        style={{ ["--active" as any]: ACTIVE }}
                        title={s.label}
                      >
                        {/* Label normale */}
                        <span
                          className={`${labelCls} ${isActive ? activeCls : idleCls} group-hover:hidden`}
                        >
                          {displayText}
                        </span>

                        {/* Label hover (short) */}
                        {!isActive && (
                          <span
                            className={`${labelCls} ${idleCls} hidden group-hover:inline`}
                          >
                            {s.short}
                          </span>
                        )}
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
