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

export default function ZonesLayer({
  roofId,
  interactive = false, // ⬅️ NUOVO: se true, la zona è cliccabile
}: {
  roofId: string;
  interactive?: boolean;
}) {
  const zones = usePlannerV2Store((s) => s.zones);
  const selectedZoneId = usePlannerV2Store((s) => s.selectedZoneId);
  const setSelectedZone = usePlannerV2Store((s) => s.setSelectedZone);
  const removeZone = usePlannerV2Store((s) => s.removeZone);

  const zonesForRoof = useMemo(
    () => zones.filter((z) => z.roofId === roofId),
    [zones, roofId]
  );

  // Backspace elimina la zona selezionata (se esiste)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedZoneId) {
        removeZone(selectedZoneId);
        setSelectedZone(undefined);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedZoneId, removeZone, setSelectedZone]);

  if (!zonesForRoof.length) return null;

  return (
    // Il gruppo visuale NON ascolta eventi; la hit-area è condizionale
    <Group listening={false}>
      {zonesForRoof.map((z) => {
        const flat = toFlatSafe(z.points);
        if (!flat) return null;

        const isSel = z.id === selectedZoneId;
        const stroke = isSel ? '#ff2d55' : '#ff5f56';
        const strokeWidth = isSel ? 2 : 0.8;
        const fill = isSel ? 'rgba(255,95,86,0.28)' : 'rgba(255,95,86,0.18)';

        return (
          <Group key={z.id} listening={false}>
            {/* Visual */}
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

            {/* Hit-area solo se interattivo (sulla falda selezionata) */}
            {interactive && (
              <Line
                points={flat}
                closed
                stroke="transparent"
                strokeWidth={14}
                hitStrokeWidth={14}
                listening
                onClick={(e) => {
                  e.cancelBubble = true; // non far propagare ai pannelli/sfondo
                  setSelectedZone(z.id);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  setSelectedZone(z.id);
                }}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
