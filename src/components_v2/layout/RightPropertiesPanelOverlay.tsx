// src/components_v2/layout/RightPropertiesPanelOverlay.tsx
"use client";

import ModulesPanel from "../panels/ModulesPanel";

export default function RightPropertiesPanelOverlay() {
  return (
    <div className="glass-panel-elevated w-[var(--propW,264px)] max-w-[92vw] h-full min-h-0 flex flex-col overflow-hidden rounded-bl-2xl rounded-tl-none border-l border-border/70">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h3 className="ps-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ebenen</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 text-sm">
        <ModulesPanel />
      </div>
    </div>
  );
}
