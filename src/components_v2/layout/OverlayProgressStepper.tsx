'use client';

import { useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { User, Home, Grid, GitBranch, ListChecks, BadgeCheck, Check, Search } from 'lucide-react';
import TopbarAddressSearch from './TopbarAddressSearch';

type StoreKey = 'building' | 'modules' | 'strings' | 'parts';
type Step =
  | { key: 'profile';  label: string; short: string; Icon: any; clickable: false }
  | { key: 'building'; label: string; short: string; Icon: any; clickable: true  }
  | { key: 'modules';  label: string; short: string; Icon: any; clickable: true  }
  | { key: 'strings';  label: string; short: string; Icon: any; clickable: false }
  | { key: 'parts';    label: string; short: string; Icon: any; clickable: false }
  | { key: 'offer';    label: string; short: string; Icon: any; clickable: false };

const STEPS: Step[] = [
  { key: 'profile',  label: 'Profil',          short: 'Profil',     Icon: User,       clickable: false },
  { key: 'building', label: 'Gebäudeplanung',  short: 'Gebäude',    Icon: Home,       clickable: true  },
  { key: 'modules',  label: 'Modulplanung',    short: 'Module',     Icon: Grid,       clickable: true  },
  { key: 'strings',  label: 'String',          short: 'String',     Icon: GitBranch,  clickable: false },
  { key: 'parts',    label: 'Stückliste',      short: 'Stückliste', Icon: ListChecks, clickable: false },
  { key: 'offer',    label: 'Angebot',         short: 'Angebot',    Icon: BadgeCheck, clickable: false },
];

export default function OverlayProgressStepper() {
  const step = usePlannerV2Store((s) => s.step);          // 'building' | 'modules' | 'strings' | 'parts'
  const setStep = usePlannerV2Store((s) => s.setStep);

  // indice attivo in base allo step dello store (anche se lo step non è cliccabile)
  const activeIndex = useMemo(
    () => Math.max(0, STEPS.findIndex((s) => (s.key as any) === step)),
    [step]
  );

  return (
    <div
   className="planner-topbar fixed left-0 right-0 top-0 z-40 border-b border-neutral-200 bg-white shadow-sm"
  style={{ paddingLeft: 'var(--sb, 64px)' }}
    >
      <div className="flex h-12 w-full items-center gap-3 px-3">
        {/* LEFT: placeholder barra ricerca indirizzo */}
   <div className="hidden md:flex">
  <TopbarAddressSearch />
</div>

        <div className="flex-1" />

        {/* RIGHT: stepper minimal, allineato a destra */}
        <nav aria-label="Wizard progress" className="mr-1">
          <ol className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const isActive = i === activeIndex;
              const isCompleted = i < activeIndex; // mostra check sui precedenti (anche se non cliccabili)
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
                  <Icon className={`h-3.5 w-3.5 ${isActive ? 'opacity-90' : 'opacity-60'}`} />
                  <span className={`hidden sm:inline text-[10px] ${isActive ? 'text-neutral-900' : 'text-neutral-700'}`}>
                    {s.short}
                  </span>
                </>
              );

              return (
                <li key={s.key} className="flex items-center gap-2">
                  {s.clickable ? (
                    <button
                      type="button"
                      onClick={() => setStep(s.key as StoreKey)}
                      title={s.label}
                      aria-current={isActive ? 'step' : undefined}
                      className={`${btnBase} ${btnCls}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={`${btnBase} opacity-70 cursor-default select-none`}>{content}</div>
                  )}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={`h-px w-5 rounded-full ${
                        i < activeIndex ? 'bg-emerald-600' : 'bg-neutral-200'
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
