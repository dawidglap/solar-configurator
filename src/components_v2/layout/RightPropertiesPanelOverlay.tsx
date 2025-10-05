// src/components_v2/layout/RightPropertiesPanelOverlay.tsx
'use client';

import ModulesPanel from '../panels/ModulesPanel';


export default function RightPropertiesPanelOverlay() {
  return (
    <div className="w-[var(--propW,264px)] max-w-[92vw] h-full min-h-0 bg-white/95 border border-neutral-200 shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white/90 backdrop-blur">
        <h3 className="text-xs font-medium ps-1">Eigenschaften</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 text-sm">
        <ModulesPanel />
        
      </div>
    </div>
  );
}
