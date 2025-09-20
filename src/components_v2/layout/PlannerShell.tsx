'use client';

import CanvasStage from '../canvas/CanvasStage';
import PageContainer from '../layout/PageContainer';
import PlannerEmptyState from '../layout/PlannerEmptyState';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function PlannerShell() {
  const snap = usePlannerV2Store(s => s.snapshot);
  return (
    <PageContainer>
      <div className="h-[calc(100vh-0px)] w-full bg-neutral-100 overflow-hidden">
        {!snap?.url && <PlannerEmptyState />}
        <CanvasStage />
      </div>
    </PageContainer>
  );
}
