'use client';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function LeftLayersPanel() {
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const select = usePlannerV2Store((s) => s.select);
  const del = usePlannerV2Store((s) => s.deleteLayer);

  return (
    <div className="h-full w-full p-3">
      <h3 className="mb-2 text-sm font-semibold">Ebenen</h3>
      {layers.length === 0 && (
        <p className="text-sm text-neutral-600">Noch keine Ebenen.</p>
      )}
      <div className="space-y-2">
        {layers.map((l) => (
          <div
            key={l.id}
            className={`flex items-center justify-between rounded-lg border px-2 py-1 text-sm ${
              selectedId === l.id ? 'bg-blue-50 border-blue-200' : 'bg-white'
            }`}
          >
            <button onClick={() => select(l.id)} className="text-left truncate">{l.name}</button>
            <button onClick={() => del(l.id)} className="text-red-600 hover:underline">Löschen</button>
          </div>
        ))}
      </div>
    </div>
  );
}
