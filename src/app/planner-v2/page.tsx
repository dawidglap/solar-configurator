// src/app/planner-v2/page.tsx
"use client";

import { useState } from "react";
import PlannerShell from "@/components_v2/layout/PlannerShell";
import ResponsiveGuard from "@/components_v2/layout/ResponsiveGuard";
import PlannerWelcomeScreen from "@/components_v2/layout/PlannerWelcomeScreen";
import { usePlannerV2Store } from "@/components_v2/state/plannerV2Store";

export default function PlannerV2Page() {
  const setStep = usePlannerV2Store((s) => s.setStep);

  // stato locale: se l'utente ha già cliccato "Neue Planung starten"
  const [started, setStarted] = useState(false);

  const handleStartNew = () => {
    // in futuro qui potremo fare un vero reset del progetto
    // per ora andiamo semplicemente allo step "profile"
    setStep("profile");
    setStarted(true);
  };

  return (
    <main className="min-h-screen w-full">
      <ResponsiveGuard minWidth={900}>
        {!started ? (
          // 👇 Schermata iniziale (logo + 2 bottoni)
          <PlannerWelcomeScreen onStartNew={handleStartNew} />
        ) : (
          // 👇 Dopo il click su "Neue Planung starten"
          <PlannerShell />
        )}
      </ResponsiveGuard>
    </main>
  );
}
