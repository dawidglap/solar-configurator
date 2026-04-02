// src/app/planner-v2/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlannerShell from "@/components_v2/layout/PlannerShell";
import ResponsiveGuard from "@/components_v2/layout/ResponsiveGuard";
import PlannerWelcomeScreen from "@/components_v2/layout/PlannerWelcomeScreen";
import { usePlannerV2Store } from "@/components_v2/state/plannerV2Store";
import { usePlanningLoad } from "@/components_v2/state/usePlanningLoad";
import { useAutoSave } from "@/components_v2/state/planning/useAutoSave";

export default function PlannerV2Page() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId");

  usePlanningLoad();
  useAutoSave();

  const setStep = usePlannerV2Store((s) => s.setStep);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (planningId) setStarted(true);
  }, [planningId]);

  const handleStartNew = () => {
    setStep("profile");
    setStarted(true);
  };

  return (
    <main className="min-h-screen w-full">
      <ResponsiveGuard minWidth={900}>
        {!started ? (
          <PlannerWelcomeScreen onStartNew={handleStartNew} />
        ) : (
          <PlannerShell />
        )}
      </ResponsiveGuard>
    </main>
  );
}
