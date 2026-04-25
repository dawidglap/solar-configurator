"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { savePlannerToDb } from "../state/planning/savePlanning";
import {
  User,
  Home,
  ListChecks,
  BadgeCheck,
  Map,
  FileText,
} from "lucide-react";
import ThemeSwitcher from "../theme/ThemeSwitcher";

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

export default function OverlayProgressStepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const sp = useSearchParams();
  const planningId = sp.get("planningId");

  const [isRedirecting, setIsRedirecting] = useState(false);

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        UI_STEPS.findIndex((s) => s.key === (step as any)),
      ),
    [step],
  );

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

  const goToLovableStep = async (
    target: "stueckliste" | "bericht" | "angebot",
  ) => {
    if (!planningId || isRedirecting) return;

    try {
      setIsRedirecting(true);

      if (target === "stueckliste" && step === "modules") {
        try {
          const snapshotDataUrl =
            await window.__helionicCaptureProjectSnapshot?.();

          if (snapshotDataUrl) {
            await fetch(
              `https://planner.helionic.ch/api/plannings/${planningId}/snapshot-cache`,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  snapshotDataUrl,
                  type: "module-layout",
                  createdAt: new Date().toISOString(),
                }),
              },
            );

            console.log("[Planner] Snapshot uploaded to temporary cache");
          } else {
            console.warn("[Planner] No snapshot captured");
          }
        } catch (err) {
          console.warn("[Planner] Snapshot upload failed:", err);
        }
      }

      await savePlannerToDb(planningId);
      window.location.href = `https://app.helionic.ch/planung/${planningId}/${target}`;
    } catch (err) {
      console.error(`Failed to save before redirecting to ${target}:`, err);
      alert("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      setIsRedirecting(false);
    }
  };

  return (
    <div
      ref={barRef}
      className="fixed left-0 right-0 top-0 z-[200] planner-topbar text-foreground"
      style={{ paddingLeft: "var(--sb, 0px)" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" />

      <div className="glass-topbar relative flex h-10 w-full items-center justify-between gap-4 rounded-tl-2xl border-l border-border/60 px-4">
        <nav aria-label="Wizard progress" className="min-w-0 flex-1 overflow-hidden">
          <div className="relative flex w-full justify-start">
            <ol className="relative flex w-auto items-center justify-start gap-2.5">
              {UI_STEPS.map((s, i) => {
                const isActive = i === activeIndex;

                const onClick = async () => {
                  if (!s.clickable || isRedirecting) return;

                  if (
                    s.key === "profile" ||
                    s.key === "ist" ||
                    s.key === "building" ||
                    s.key === "modules"
                  ) {
                    setStep(s.key);
                    return;
                  }

                  if (s.key === "parts") {
                    await goToLovableStep("stueckliste");
                    return;
                  }

                  if (s.key === "report") {
                    await goToLovableStep("bericht");
                    return;
                  }

                  if (s.key === "offer") {
                    await goToLovableStep("angebot");
                    return;
                  }

                  return;
                };

                const base =
                  "relative z-[1] flex-none px-0.5 py-1 text-left transition-colors select-none";
                const labelCls =
                  "text-[13px] md:text-[13px] font-medium whitespace-nowrap transition-colors";
                const activeCls = "bg-primary text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/0.18)]";
                const completedCls = i < activeIndex ? "bg-primary/12 text-primary ring-1 ring-primary/20" : "";
                const idleCls = "text-muted-foreground hover:text-foreground";
                const disabledCls = "text-muted-foreground/60 cursor-default";

                const displayText = !isActive ? s.short : s.label;

                return (
                  <li key={s.key} className="min-w-0 flex-none">
                    {s.clickable ? (
                      <button
                        type="button"
                        onClick={onClick}
                        disabled={isRedirecting}
                        aria-current={isActive ? "step" : undefined}
                        className={`${base} focus:outline-none group cursor-pointer disabled:opacity-50 disabled:cursor-wait`}
                        title={s.label}
                      >
                        <span
                          className={`${labelCls} inline-flex items-center rounded-2xl px-4 py-1.5 ${
                            isActive ? activeCls : completedCls || idleCls
                          } ${!isActive ? "group-hover:hidden" : ""}`}
                        >
                          {isRedirecting && s.key === "parts"
                            ? "Speichert..."
                            : displayText}
                        </span>

                        {!isActive && !isRedirecting && (
                          <span
                            className={`${labelCls} ${idleCls} hidden items-center rounded-2xl px-4 py-1.5 group-hover:inline-flex`}
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
        <ThemeSwitcher />
      </div>
    </div>
  );
}
