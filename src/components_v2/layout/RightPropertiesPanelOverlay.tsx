'use client';

import { ChangeEvent } from 'react';
import { X } from 'lucide-react';

import { usePlannerV2Store } from '../state/plannerV2Store';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';
import ModulesPanel from '../panels/ModulesPanel';

export default function RightPropertiesPanelOverlay() {
  const step = usePlannerV2Store((s) => s.step);
  const setUI = usePlannerV2Store((s) => s.setUI);

  return (
    <div className="w-[240px] max-w-[92vw] h-auto rounded-2xl bg-white/95 border border-neutral-200 shadow-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-xs font-medium">Eigenschaften</h3>
        <button
          onClick={() => setUI({ rightPanelOpen: false })}
          className="p-1 rounded hover:bg-neutral-100"
          title="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

  <div className="flex-1 overflow-y-auto p-3 text-sm">
  {step === 'building' && <BuildingPanel />}
  {step === 'modules' && <ModulesPanel />}
  {step === 'strings' && (
    <p className="text-neutral-600 text-xs">Stringplanung (später).</p>
  )}
  {step === 'parts' && (
    <p className="text-neutral-600 text-xs">Stückliste & Preise (später).</p>
  )}
</div>
    </div>
  );
}

/** PANEL: Building
 *  - NIENTE ricerca indirizzo (ora è al centro all’avvio)
 *  - “Erkannte Dächer” (DetectedRoofsImport)
 *  - Upload fallback per lo sfondo (senza georef → niente Sonnendach)
 *  - Piccole info snapshot, se presenti
 */
function BuildingPanel() {
  const snapshot = usePlannerV2Store((s) => s.snapshot);
  const setSnapshot = usePlannerV2Store((s) => s.setSnapshot);
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
        clearDetectedRoofs(); // upload non georeferenziato → non possiamo proporre tetti
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
    </div>
  );
}
