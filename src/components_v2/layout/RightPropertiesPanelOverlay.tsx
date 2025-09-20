'use client';

import { ChangeEvent, useEffect } from 'react';
import { X } from 'lucide-react';

import { usePlannerV2Store } from '../state/plannerV2Store';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';
import ModulesPanel from '../panels/ModulesPanel';

/**
 * NOTE: anche se il nome del componente dice "Right", ora è un pannello
 * DOCK A SINISTRA. L’allineamento tiene conto di:
 *  - --sb  (larghezza sidebar: 64px/224px)
 *  - --tb  (altezza topbar/stepper)
 */
export default function RightPropertiesPanelOverlay() {
  const step   = usePlannerV2Store((s) => s.step);
  const setUI  = usePlannerV2Store((s) => s.setUI);

  return (
    <div className="w-[260px] max-w-[92vw] mt-[34px] h-full min-h-0 bg-slate-100 border border-neutral-200 shadow-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-200 backdrop-blur">
        <h3 className="text-xs font-medium">Eigenschaften</h3>
        <button
          onClick={() => setUI({ rightPanelOpen: false })}
          className="p-1 rounded-full bg-red-400 hover:bg-red-500"
          title="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {step === 'building' && <BuildingPanel />}
        {step === 'modules'  && <ModulesPanel />}
        {step === 'strings'  && <p className="text-neutral-600 text-xs">Stringplanung (später).</p>}
        {step === 'parts'    && <p className="text-neutral-600 text-xs">Stückliste & Preise (später).</p>}
      </div>
    </div>
  );
}

/** PANEL: Building */
function BuildingPanel() {
  const setSnapshot        = usePlannerV2Store((s) => s.setSnapshot);
  const clearDetectedRoofs = usePlannerV2Store((s) => s.clearDetectedRoofs);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setSnapshot({ url, width: img.naturalWidth, height: img.naturalHeight });
        // upload non georeferenziato → niente tetti proposti
        clearDetectedRoofs();
      };
      img.src = url;
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="space-y-6">
      <section>
        <DetectedRoofsImport />
      </section>

      {/* <section>
        <h4 className="mb-1 text-xs font-semibold text-neutral-900">Hintergrund (Upload)</h4>
        <input
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="w-full cursor-pointer rounded-md border px-2 py-1.5 text-[13px]"
          title="Screenshot/Bild hochladen"
        />
      </section> */}
    </div>
  );
}
