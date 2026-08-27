// src/app/planner-v2/page.tsx
"use client";

import PlannerShell from "@/components_v2/layout/PlannerShell";
import PlannerLoadingShell from "@/components_v2/layout/PlannerLoadingShell";
import { usePlanningLoad } from "@/components_v2/state/usePlanningLoad";
import { useAutoSave } from "@/components_v2/state/planning/useAutoSave";
import { useCatalogPanels } from "@/components_v2/state/useCatalogPanels";
import { usePlannerV2Store } from "@/components_v2/state/plannerV2Store";
import { isPlannerReady } from "@/components_v2/state/planning/plannerLoadState";

export default function PlannerV2Page() {
  const planningLoad = usePlanningLoad();
  const storeHydrated = usePlannerV2Store((state) => state.hydrationReady);
  useAutoSave();
  useCatalogPanels();
  const plannerReady = isPlannerReady({
    routeStatus: planningLoad.status,
    storeHydrated,
  });

  return (
    <main className="app-shell min-h-screen w-full bg-background text-foreground">
      {plannerReady ? (
        <PlannerShell />
      ) : (
        <PlannerLoadingShell error={planningLoad.error} />
      )}
    </main>
  );
}
