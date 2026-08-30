// src/components_v2/layout/RightPropertiesPanelOverlay.tsx
"use client";

import ModulesPanel from "../panels/ModulesPanel";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function RightPropertiesPanelOverlay() {
  const step = usePlannerV2Store((state) => state.step);

  return (
    <div className="glass-panel-elevated planner-surface-sidebar w-[var(--propW,264px)] max-w-[92vw] h-full min-h-0 flex flex-col overflow-hidden rounded-bl-2xl rounded-tl-none border-l border-border/70">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h3 className="ps-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {step === "building" ? "Dachflächen" : "Modulplanung"}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 text-sm">
        <ModulesPanel />
      </div>
    </div>
  );
}
