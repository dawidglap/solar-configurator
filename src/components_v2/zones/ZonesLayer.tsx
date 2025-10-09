'use client';
import React, { useMemo, useEffect } from 'react';
import { Group, Line } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import type { Pt } from '@/types/planner';
import ZoneHandlesKonva from './ZoneHandlesKonva';

function toFlatSafe(pts: Pt[]): number[] | null {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const out: number[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    out.push(p.x, p.y);
  }
  return out;
}

export default function ZonesLayer({
  roofId,
  interactive = false,
  shapeMode = 'normal',
  toImg,
  imgW,
  imgH,
}: {
  roofId: string;
  interactive?: boolean;
  shapeMode?: 'normal' | 'trapezio';
  toImg: (sx: number, sy: number) => Pt;
  imgW: number;
  imgH: number;
}) {
  const zones = usePlannerV2Store((s) => s.zones);
  const selectedZoneId = usePlannerV2Store((s) => s.selectedZoneId);
  const setSelectedZone = usePlannerV2Store((s) => s.setSelectedZone);
  const updateZone = usePlannerV2Store((s) => s.updateZone);
  const removeZone = usePlannerV2Store((s) => s.removeZone);

  const zonesForRoof = useMemo(() => zones.filter(z => z.roofId === roofId), [zones, roofId]);

  // Backspace su zona selezionata
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && selectedZoneId) {
        removeZone(selectedZoneId);
        setSelectedZone(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedZoneId, removeZone, setSelectedZone]);

  if (!zonesForRoof.length) return null;

  return (
    <Group listening>
      {zonesForRoof.map((z) => {
        const flat = toFlatSafe(z.points);
        if (!flat) return null;

        const isSel = z.id === selectedZoneId;
        const stroke = isSel ? '#948979' : '#DFD0B8';
        const strokeWidth = isSel ? 2 : 0.8;
        const fill = isSel ? 'rgba(148, 137, 121, 0.28)' : 'rgba(148, 137, 121, 0.18)';

        return (
          <Group key={z.id}>
            {/* visuale */}
            <Line
              points={flat}
              closed
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              shadowColor={isSel ? '#948979' : undefined}
              shadowBlur={isSel ? 6 : 0}
              listening={false}
            />

            {/* hit-area per selezione (blocca bubbling) */}
            <Line
              points={flat}
              closed
              stroke="transparent"
              strokeWidth={14}
              hitStrokeWidth={14}
              listening
              onClick={(e) => { e.cancelBubble = true; setSelectedZone(z.id); }}
              onTap={(e) => { e.cancelBubble = true; setSelectedZone(z.id); }}
            />

            {/* maniglie SOLO quando: zona selezionata + interattiva + modalità trapezio */}
            {interactive && isSel && shapeMode === 'trapezio' && (
              <ZoneHandlesKonva
                points={z.points}
                imgW={imgW}
                imgH={imgH}
                toImg={toImg}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onChange={(next) => updateZone(z.id, { points: next })}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
