'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import {
  User, Home, GitBranch, ListChecks, BadgeCheck, Check,
  Monitor, Map, FileText
} from 'lucide-react';
import TopbarAddressSearch from './TopbarAddressSearch';

// NON tocchiamo lo store
type StoreKey = 'building' | 'modules' | 'strings' | 'parts';

// Step UI: “planning” è virtuale e rappresenta building+modules
type UiStep =
  | { key: 'profile';    label: string; short: string; Icon: any; clickable: false }
  | { key: 'presentation';label: string; short: string; Icon: any; clickable: false }
  | { key: 'ist';        label: string; short: string; Icon: any; clickable: false }
  | { key: 'planning';   label: string; short: string; Icon: any; clickable: true  } // ← unifica
  | { key: 'strings';    label: string; short: string; Icon: any; clickable: false }
  | { key: 'parts';      label: string; short: string; Icon: any; clickable: false }
  | { key: 'report';     label: string; short: string; Icon: any; clickable: false }
  | { key: 'offer';      label: string; short: string; Icon: any; clickable: false };

const UI_STEPS: UiStep[] = [
  { key: 'profile',     label: 'Profil',         short: 'Profil',         Icon: User,      clickable: false },
  { key: 'presentation',label: 'Präsentation',   short: 'Präsentation',    Icon: Monitor,   clickable: false },
  { key: 'ist',         label: 'IST-Situation',  short: 'IST-Situation',   Icon: Map,       clickable: false },
  { key: 'planning',    label: 'Planungsmodus',  short: 'Planungsmodus',   Icon: Home,      clickable: true  }, // building+modules
  { key: 'strings',     label: 'String',         short: 'String',          Icon: GitBranch, clickable: false },
  { key: 'parts',       label: 'Stückliste',     short: 'Stückliste',      Icon: ListChecks,clickable: false },
  { key: 'report',      label: 'Bericht',        short: 'Bericht',         Icon: FileText,  clickable: false },
  { key: 'offer',       label: 'Angebot',        short: 'Angebot',         Icon: BadgeCheck,clickable: false },
];

export default function OverlayProgressStepper() {
  const step    = usePlannerV2Store((s) => s.step);     // 'building' | 'modules' | 'strings' | 'parts'
  const setStep = usePlannerV2Store((s) => s.setStep);

  // Mappiamo building/modules → planning; altri step come da store
  const activeIndex = useMemo(() => {
    const uiKey =
      step === 'building' || step === 'modules'
        ? 'planning'
        : (step as any);
    return Math.max(0, UI_STEPS.findIndex((s) => s.key === uiKey));
  }, [step]);

  // Aggiorna --tb con l’altezza reale della topbar
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.offsetHeight || 48;
      document.body.style.setProperty('--tb', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.removeProperty('--tb');
    };
  }, []);

  return (
    <div
      ref={barRef}
      className="planner-topbar fixed left-0 right-0 top-0 z-40 border-b border-neutral-200 bg-white shadow-sm"
      style={{ paddingLeft: 'var(--sb, 64px)' }}
    >
      <div className="flex h-12 w-full items-center gap-3 px-3">
        {/* LEFT: barra ricerca indirizzo */}
        {/* <div className="hidden md:flex">
          <TopbarAddressSearch />
        </div> */}

        <div className="flex-1" />

        {/* RIGHT: stepper minimal */}
        <nav aria-label="Wizard progress" className="mr-1">
          <ol className="flex items-center gap-2">
            {UI_STEPS.map((s, i) => {
              const isActive = i === activeIndex;
              const isCompleted = i < activeIndex;
              const Icon = s.Icon;

              const btnBase = 'group flex items-center gap-1.5 rounded-full px-2 py-1 transition';
              const btnCls = isActive ? 'bg-neutral-900/5' : 'hover:bg-neutral-900/5';
              const dot = 'flex h-5 w-5 items-center justify-center rounded-full border text-[9px] leading-none tabular-nums';
              const dotCls = isActive
                ? 'bg-black text-white border-black'
                : isCompleted
                ? 'bg-emerald-600 text-white border-emerald-700'
                : 'bg-white text-neutral-700 border-neutral-300';

              const content = (
                <>
                  <span className={`${dot} ${dotCls}`}>
                    {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {/* <Icon className={`h-3.5 w-3.5 ${isActive ? 'opacity-90' : 'opacity-60'}`} /> */}
                  <span className={`hidden sm:inline text-[10px] ${isActive ? 'text-neutral-900' : 'text-neutral-700'}`}>
                    {s.short}
                  </span>
                </>
              );

              const onClick = () => {
                if (s.key === 'planning') {
                  // opzionale: forzare ‘building’ come atterraggio
                  // setStep('building' as StoreKey);
                  return;
                }
                // Le altre voci sono non cliccabili (clickable: false). Se un giorno servirà:
                // setStep(s.key as StoreKey);
              };

              return (
                <li key={s.key} className="flex items-center gap-2">
                  {s.clickable ? (
                    <button
                      type="button"
                      onClick={onClick}
                      title={s.label}
                      aria-current={isActive ? 'step' : undefined}
                      className={`${btnBase} ${btnCls}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={`${btnBase} opacity-70 cursor-default select-none`}>{content}</div>
                  )}
                  {i < UI_STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={`h-px w-5 rounded-full ${i < activeIndex ? 'bg-emerald-600' : 'bg-neutral-200'}`}
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
