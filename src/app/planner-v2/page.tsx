// src/app/planner-v2/page.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import PlannerShell from "@/components_v2/layout/PlannerShell";
import { usePlannerV2Store } from "@/components_v2/state/plannerV2Store";
import { normalizePlannerStep } from "@/components_v2/state/normalizePlannerStep";
import { usePlanningLoad } from "@/components_v2/state/usePlanningLoad";
import { useAutoSave } from "@/components_v2/state/planning/useAutoSave";

export default function PlannerV2Page() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId");
  const requestedStep =
    normalizePlannerStep(sp.get("plannerStep")) ||
    normalizePlannerStep(sp.get("initialStep")) ||
    normalizePlannerStep(sp.get("step")) ||
    normalizePlannerStep(sp.get("currentStep")) ||
    "building";

  usePlanningLoad();
  useAutoSave();

  const setStep = usePlannerV2Store((s) => s.setStep);

  useEffect(() => {
    setStep(requestedStep);
  }, [planningId, requestedStep, setStep]);

  return (
    <main className="app-shell min-h-screen w-full bg-background text-foreground">
      <PlannerShell />
    </main>
  );
}
