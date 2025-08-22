'use client';

import type { PlannerStep } from '../state/plannerV2Store';

export default function RightPropertiesPanel({
  currentStep,
}: {
  currentStep: PlannerStep;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-3 text-sm font-medium">Eigenschaften</header>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {currentStep === 'building' && (
          <p className="text-neutral-600">
            Wählen Sie ein Werkzeug aus, um Dachflächen zu zeichnen.
          </p>
        )}
        {currentStep === 'modules' && (
          <p className="text-neutral-600">
            Modultyp, Orientierung, Abstände – kommen gleich.
          </p>
        )}
        {currentStep === 'strings' && (
          <p className="text-neutral-600">Stringplanung (später).</p>
        )}
        {currentStep === 'parts' && (
          <p className="text-neutral-600">Stückliste & Preise (später).</p>
        )}
      </div>
    </div>
  );
}
