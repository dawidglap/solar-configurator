'use client';
import React, { useMemo, useEffect } from 'react';
import { Group, Line } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import type { Pt } from '@/types/planner';

function toFlatSafe(pts: Pt[]): number[] | null {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const flat: number[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    flat.push(p.x, p.y);
  }
  return flat;
}

export default function ZonesLayer({ roofId }: { roofId: string }) {
  const zones = usePlannerV2Store((s) => s.zones);
  const selectedZoneId = usePlannerV2Store((s) => s.selectedZoneId);
  const setSelectedZone = usePlannerV2Store((s) => s.setSelectedZone);
  const removeZone = usePlannerV2Store((s) => s.removeZone);

  const zonesForRoof = useMemo(
    () => zones.filter((z) => z.roofId === roofId),
    [zones, roofId]
  );

  // 🔴 gestione Backspace per cancellare zona selezionata
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && selectedZoneId) {
        removeZone(selectedZoneId);
        setSelectedZone(undefined);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedZoneId, removeZone, setSelectedZone]);

  if (!zonesForRoof.length) return null;

  return (
    <Group listening>
      {zonesForRoof.map((z) => {
        const flat = toFlatSafe(z.points);
        if (!flat) return null;

        const isSel = z.id === selectedZoneId;
        const stroke = isSel ? '#ff2d55' : '#ff5f56';
        const strokeWidth = isSel ? 2 : 0.8;
        const fill = isSel ? 'rgba(255,95,86,0.28)' : 'rgba(255,95,86,0.18)';

        return (
          <Group key={z.id}>
            {/* visuale */}
            <Line
              points={flat}
              closed
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              shadowColor={isSel ? '#ff2d55' : undefined}
              shadowBlur={isSel ? 6 : 0}
              listening={false}
            />

            {/* hit-area */}
            <Line
              points={flat}
              closed
              stroke="transparent"
              strokeWidth={14}
              hitStrokeWidth={14}
              listening
              onClick={() => setSelectedZone(z.id)}
              onTap={() => setSelectedZone(z.id)}
            />
          </Group>
        );
      })}
    </Group>
  );
}
