'use client';

import { useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import {
  Home,
  Grid,
  GitBranch,
  ListChecks,
  Check,
} from 'lucide-react';

type Key = 'building' | 'modules' | 'strings' | 'parts';

type StepCfg = {
  key: Key;
  label: string;   // label completa (tooltip, desktop)
  short: string;   // label breve (mobile)
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const STEPS: StepCfg[] = [
  { key: 'building', label: 'Gebäudeplanung', short: 'Gebäude',   Icon: Home },
  { key: 'modules',  label: 'Modulplanung',   short: 'Module',    Icon: Grid },
  { key: 'strings',  label: 'Strings',        short: 'Strings',   Icon: GitBranch },
  { key: 'parts',    label: 'Stückliste',     short: 'Stückliste',Icon: ListChecks },
];

export default function OverlayProgressStepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const activeIndex = useMemo(() => STEPS.findIndex(s => s.key === step), [step]);

  return (
  <div
  className="
    pointer-events-none
    absolute z-[120]
    top-2
    left-1/2 -translate-x-1/2
    w-auto
    px-2
  "
>
      <nav
        aria-label="Wizard progress"
        className="
          pointer-events-auto
          rounded-full border border-neutral-200/80
          bg-white/75 backdrop-blur
          shadow-sm
          px-2 py-[2px]
        "
      >
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const isActive = i === activeIndex;
            const isCompleted = i < activeIndex;
            const isFuture = i > activeIndex;

            const baseDot =
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px]';
            const dotCls = isActive
              ? 'bg-black text-white border-black'
              : isCompleted
              ? 'bg-green-600 text-white border-green-700'
              : 'bg-white text-neutral-700 border-neutral-300';

            const Icon = s.Icon;

            return (
              <li key={s.key} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(s.key)}
                  title={s.label}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    group flex items-center gap-2 rounded-full px-1.5 py-1
                    transition
                    ${isActive ? 'bg-neutral-900/5' : 'hover:bg-neutral-900/5'}
                  `}
                >
                  {/* Dot / Check */}
                  <span className={`${baseDot} ${dotCls}`}>
                    {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
                  </span>

                  {/* Icon + label (micro) */}
                  <span className="flex items-center gap-1.5">
                    <Icon
                      className={`
                        h-3.5 w-3.5
                        ${isActive ? 'opacity-90' : isFuture ? 'opacity-50' : 'opacity-80'}
                      `}
                      aria-hidden
                    />
                    <span
                      className={`
                        hidden sm:inline text-[11px]
                        ${isActive ? 'text-neutral-900' : 'text-neutral-700'}
                      `}
                    >
                      {s.label}
                    </span>
                    <span
                      className={`
                        sm:hidden text-[10px]
                        ${isActive ? 'text-neutral-900' : 'text-neutral-700'}
                      `}
                    >
                      {s.short}
                    </span>
                  </span>
                </button>

                {/* Connector */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={`
                      h-[2px] w-6 rounded-full
                      ${i < activeIndex ? 'bg-green-600'
                        : i === activeIndex ? 'bg-neutral-400'
                        : 'bg-neutral-200'}
                    `}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
