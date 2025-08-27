'use client';

import LeftLayersPanel from './LeftLayersPanel';
import RightPropertiesPanel from './RightPropertiesPanel';
import CanvasStage from '../canvas/CanvasStage';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function PlannerShell() {
  const step = usePlannerV2Store((s) => s.step);

  return (
    <div className="h-[calc(100vh-0px)] w-full bg-neutral-100 flex flex-col max-w-[1440px] mx-auto">
      {/* Stepper */}
    
  {/* Workspace: mappa al centro = 1fr, pannelli stretti */}
      <div
        className="
          flex-1 min-h-0
          grid gap-2 px-2 py-2
          grid-cols-[200px_1fr_220px]
          xl:grid-cols-[220px_1fr_240px]
        "
      >
        <div className="h-full overflow-auto rounded-xl border bg-white/85 backdrop-blur-sm">
          <LeftLayersPanel />
        </div>

        <div className="h-full overflow-hidden rounded-xl border bg-white">
          <CanvasStage />
        </div>

        <div className="h-full overflow-auto rounded-xl border bg-white/85 backdrop-blur-sm">
          <RightPropertiesPanel currentStep={step} />
        </div>
      </div>
    </div>
  );
}

function Stepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);

  const steps: { key: any; short: string; full: string }[] = [
    { key: 'building', short: 'Gebäude',    full: 'Gebäudeplanung' },
    { key: 'modules',  short: 'Module',     full: 'Modulplanung' },
    { key: 'strings',  short: 'Strings',    full: 'Strings' },
    { key: 'parts',    short: 'Stückliste', full: 'Stückliste' },
  ];

  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => {
        const active = step === s.key;
        return (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            title={s.full}
            className={[
              'shrink-0 rounded-full px-2.5 py-1 text-xs transition border',
              active
                ? 'bg-black text-white border-black'
                : 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-200',
            ].join(' ')}
          >
            <span className="mr-1 opacity-60">{i + 1}.</span>
            <span className="sm:hidden">{s.short}</span>
            <span className="hidden sm:inline">{s.full}</span>
          </button>
        );
      })}
    </div>
  );
}
