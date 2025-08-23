'use client';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function PlannerToolbar() {
  const tool = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  const btn = (k: any, label: string) => (
    <button
      onClick={() => setTool(k)}
      className={`px-3 py-1.5 rounded-full border text-sm ${
        tool === k ? 'bg-blue-200 border-blue-300' : 'bg-white hover:bg-neutral-50'
      }`}
      title={label}
    >
      {label}
    </button>
  );

  return (
    <div className="flex gap-2">
      {btn('select', 'Auswahl')}
      {btn('draw-roof', 'Dach zeichnen')}
      {/* {btn('draw-reserved', 'Sperrzone')}  // più avanti */}
    </div>
  );
}
