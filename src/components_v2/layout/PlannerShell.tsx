// src/components_v2/layout/PlannerShell.tsx
"use client";

import { useEffect } from "react";
import CanvasStage from "../canvas/CanvasStage";
import PageContainer from "../layout/PageContainer";
import PlannerEmptyState from "../layout/PlannerEmptyState";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function PlannerShell() {
  const snap = usePlannerV2Store((s) => s.snapshot);
  const step = usePlannerV2Store((s) => s.step);
  const leftOpen = usePlannerV2Store((s) => s.ui.leftPanelOpen);
  const setUI = usePlannerV2Store((s) => s.setUI);

  // Auto-open Ebenen in Gebäudeplanung, auto-close negli altri step
  useEffect(() => {
    if (step === "building" && !leftOpen) setUI({ leftPanelOpen: true });
    if (step !== "building" && leftOpen) setUI({ leftPanelOpen: false });
  }, [step, leftOpen, setUI]);

  return (
    <PageContainer>
      <div className="h-[calc(100vh-0px)] w-full bg-neutral-100 overflow-hidden">
        {!snap?.url && <PlannerEmptyState />}
        <CanvasStage />
      </div>
    </PageContainer>
  );
}
