// src/components_v2/layout/OverlayProgressStepper.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import {
  User,
  Home,
  GitBranch,
  ListChecks,
  BadgeCheck,
  Check,
  Monitor,
  Map,
  FileText,
} from "lucide-react";

// 🔹 Ora includiamo anche 'profile' e 'ist'
type StoreKey =
  | "profile"
  | "ist"
  | "building"
  | "modules"
  | "strings"
  | "parts";

// Step UI separati
type UiStep =
  | {
      key: "profile";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
  | {
      key: "ist";
      label: string;
      short: string;
      Icon: any;
      clickable: boolean;
    }
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
  // | { key: 'strings';      label: string; short: string; Icon: any; clickable: boolean }
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
  // { key: 'strings',       label: 'String',          short: 'String',         Icon: GitBranch, clickable: false },
  {
    key: "parts",
    label: "Stückliste",
    short: "Stückliste",
    Icon: ListChecks,
    clickable: false,
  },
  {
    key: "report",
    label: "Bericht",
    short: "Bericht",
    Icon: FileText,
    clickable: false,
  },
  {
    key: "offer",
    label: "Angebot",
    short: "Angebot",
    Icon: BadgeCheck,
    clickable: false,
  },
];

export default function OverlayProgressStepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        UI_STEPS.findIndex((s) => s.key === (step as any))
      ),
    [step]
  );

  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.offsetHeight || 48;
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
      className="
      z-[200] planner-topbar fixed left-0 right-0 top-0
      border-b border-white/20
      bg-neutral-900/35
      backdrsm-blur-2xl
      shadow-[0_0_35px_rgba(0,0,0,0.70)]
      text-white
      transition
    "
      style={{ paddingLeft: "var(--sb, 64px)" }}
    >
      <div className="flex h-12 w-full items-center gap-3 px-3">
        {/* Spacer */}
        <div className="flex-1" />

        <nav aria-label="Wizard progress" className="mr-1">
          <ol className="flex items-center gap-2">
            {UI_STEPS.map((s, i) => {
              const isActive = i === activeIndex;
              const isCompleted = i < activeIndex;
              const Icon = s.Icon;

              const btnBase =
                "group flex items-center gap-1.5 rounded-full px-2 py-1 transition backdrop-blur-sm";

              const btnCls = isActive
                ? "bg-white/20 border border-white/40 shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
                : isCompleted
                ? "bg-emerald-500/20 border border-emerald-400/40 shadow-[0_4px_14px_rgba(0,0,0,0.25)]"
                : "bg-white/10 border border-white/20 hover:bg-white/20";

              const dot =
                "flex h-5 w-5 items-center justify-center rounded-full border text-[9px] leading-none";

              const dotCls = isActive
                ? "bg-emerald-500 text-white border-emerald-400"
                : isCompleted
                ? "bg-emerald-600 text-white border-emerald-500"
                : "bg-white/10 text-white border-white/30";

              const content = (
                <>
                  <span className={`${dot} ${dotCls}`}>
                    {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
                  </span>

                  <span
                    className={`hidden sm:inline text-[10px] ${
                      isActive ? "text-white" : "text-white/70"
                    }`}
                  >
                    {s.short}
                  </span>
                </>
              );

              const onClick = () => {
                if (!s.clickable) return;
                setStep(s.key as StoreKey);
              };

              return (
                <li key={s.key} className="flex items-center gap-2">
                  {s.clickable ? (
                    <button
                      type="button"
                      onClick={onClick}
                      title={s.label}
                      aria-current={isActive ? "step" : undefined}
                      className={`${btnBase} ${btnCls}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      className={`${btnBase} bg-white/5 border border-white/10 opacity-60 cursor-default select-none`}
                    >
                      {content}
                    </div>
                  )}

                  {i < UI_STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={`h-px w-5 rounded-full transition ${
                        i < activeIndex ? "bg-emerald-500" : "bg-white/25"
                      }`}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}
