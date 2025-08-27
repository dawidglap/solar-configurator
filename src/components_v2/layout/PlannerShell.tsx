'use client';

import CanvasStage from '../canvas/CanvasStage';

export default function PlannerShell() {
  return (
    <div className="h-[calc(100vh-0px)] w-full bg-neutral-100 overflow-hidden">
      <CanvasStage />
    </div>
  );
}
