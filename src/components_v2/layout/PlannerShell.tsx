// src/components_v2/layout/PlannerShell.tsx
"use client";

import { useEffect, useState } from "react";
import { useMe } from "@/hooks/useMe";
import {
  canUseExperimental3D,
  resolveEffectivePlannerViewMode,
  type PlannerViewMode,
} from "@/lib/experimental3dAccess";
import CanvasStage from "../canvas/CanvasStage";
import PageContainer from "../layout/PageContainer";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function PlannerShell() {
  const [requestedViewMode, setRequestedViewMode] = useState<PlannerViewMode>("2d");
  const meQuery = useMe();
  const canUse3D = canUseExperimental3D(meQuery.data?.user);
  const effectiveViewMode = resolveEffectivePlannerViewMode(requestedViewMode, canUse3D);
  const snap = usePlannerV2Store((s) => s.snapshot);
  const step = usePlannerV2Store((s) => s.step);
  const leftOpen = usePlannerV2Store((s) => s.ui.leftPanelOpen);
  const setUI = usePlannerV2Store((s) => s.setUI);

  // Auto-open Ebenen in Gebäudeplanung, auto-close negli altri step
  useEffect(() => {
    if (step === "building" && !leftOpen) setUI({ leftPanelOpen: true });
    if (step !== "building" && leftOpen) setUI({ leftPanelOpen: false });
  }, [step, leftOpen, setUI]);

  useEffect(() => {
    if (!canUse3D && requestedViewMode !== "2d") setRequestedViewMode("2d");
  }, [canUse3D, requestedViewMode]);

  return (
    <PageContainer>
      <div className="relative h-[calc(100vh-0px)] w-full overflow-hidden bg-background">
        <CanvasStage
          viewMode={effectiveViewMode}
          onViewModeChange={canUse3D ? setRequestedViewMode : undefined}
        />
      </div>
    </PageContainer>
  );
}
