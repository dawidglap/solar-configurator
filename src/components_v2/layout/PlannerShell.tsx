'use client';

import TopToolbar from './TopToolbar';
import LeftLayersPanel from './LeftLayersPanel';
import RightPropertiesPanel from './RightPropertiesPanel';
import CanvasStage from '../canvas/CanvasStage';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function PlannerShell() {
  const step = usePlannerV2Store((s) => s.step);
  return (
    <div className="h-[calc(100vh-64px)] w-full bg-neutral-100">
      {/* Stepper (oben) */}
      <div className="w-full border-b bg-white">
        <div className="mx-auto max-w-[1600px] px-4">
          <Stepper />
        </div>
      </div>

      {/* Toolbar */}
      <div className="w-full border-b bg-white">
        <div className="mx-auto max-w-[1600px] px-4">
          <TopToolbar />
        </div>
      </div>

      {/* Drei-Spalten Layout */}
      <div className="mx-auto grid max-w-[1600px] grid-cols-[280px_1fr_320px] gap-4 px-4 py-4">
        <div className="h-[calc(100vh-64px-96px)] overflow-hidden rounded-2xl border bg-white">
          <LeftLayersPanel />
        </div>

        <div className="h-[calc(100vh-64px-96px)] overflow-hidden rounded-2xl border bg-white">
          <CanvasStage />
        </div>

        <div className="h-[calc(100vh-64px-96px)] overflow-y-auto rounded-2xl border bg-white">
          <RightPropertiesPanel currentStep={step} />
        </div>
      </div>
    </div>
  );
}

function Stepper() {
  const step = usePlannerV2Store((s) => s.step);
  const setStep = usePlannerV2Store((s) => s.setStep);
  const steps: { key: any; label: string }[] = [
    { key: 'building', label: 'Gebäudeplanung' },
    { key: 'modules', label: 'Modulplanung' },
    { key: 'strings', label: 'Strings' },
    { key: 'parts', label: 'Stückliste' },
  ];
  return (
    <div className="flex h-12 items-center gap-2">
      {steps.map((s, i) => {
        const active = step === s.key;
        return (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            title={s.label}
            className={`rounded-full px-4 py-2 text-sm transition ${
              active
                ? 'bg-black text-white'
                : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
            }`}
          >
            {i + 1}. {s.label}
          </button>
        );
      })}
    </div>
  );
}
