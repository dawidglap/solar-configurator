'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

export default function LeftLayersPanel() {
  const areas = usePlannerV2Store((s) => s.areas);
  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-3 text-sm font-medium">Ebenen</header>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {areas.length === 0 ? (
          <p className="text-neutral-500">Noch keine Ebenen.</p>
        ) : (
          <ul className="space-y-2">
            {areas.map((a: any) => (
              <li key={a.id} className="rounded border p-2">
                {a.name ?? 'Fläche'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
