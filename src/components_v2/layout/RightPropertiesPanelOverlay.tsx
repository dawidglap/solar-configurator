// src/components_v2/layout/RightPropertiesPanelOverlay.tsx
"use client";

import ModulesPanel from "../panels/ModulesPanel";

export default function RightPropertiesPanelOverlay() {
  return (
    <div className="w-[var(--propW,264px)] max-w-[92vw] h-full min-h-0 bg-neutral-700/50 backdrop-blur-md shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2 ">
        <h3 className="text-xs font-medium ps-1 text-white">EBENEN</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 text-sm">
        <ModulesPanel />
      </div>
    </div>
  );
}
