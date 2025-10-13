'use client';
import React, { useMemo, useEffect } from 'react';
import { Group as KonvaGroup, Line as KonvaLine } from 'react-konva';
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

  const zonesForRoof = useMemo(
    () => zones.filter((z) => z.roofId === roofId),
    [zones, roofId]
  );

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

  // --- Palette rosso pieno ---
  const RED      = '#FF2D2D';              // bordo default
  const RED_SEL  = '#DC2626';              // bordo selezionato
  const FILL     = 'rgba(255,45,45,0.12)'; // riempimento leggero
  const FILL_SEL = 'rgba(255,45,45,0.20)'; // riempimento selezionato
  const W        = 0.25;                   // spessore bordo default
  const W_SEL    = 1;                      // spessore bordo selezionato

  return (
    <KonvaGroup listening>
      {zonesForRoof.map((z) => {
        const flat = toFlatSafe(z.points);
        if (!flat) return null;

        const isSel = z.id === selectedZoneId;

        return (
          <KonvaGroup key={z.id}>
            {/* shape visiva: rosso pieno, niente tratteggio */}
            <KonvaLine
              points={flat}
              closed
              fill={isSel ? FILL_SEL : FILL}
              stroke={isSel ? RED_SEL : RED}
              strokeWidth={isSel ? W_SEL : W}
              lineJoin="round"
              lineCap="round"
              listening={false}
              perfectDrawEnabled={false}
            />

            {/* hit-area per selezione (trasparente) */}
            <KonvaLine
              points={flat}
              closed
              stroke="transparent"
              strokeWidth={14}
              hitStrokeWidth={14}
              listening
              name="zone-hit interactive"
              onMouseDown={(e) => { e.cancelBubble = true; setSelectedZone(z.id); }}
              onClick={(e) => {
                e.cancelBubble = true;
                setSelectedZone(z.id);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                setSelectedZone(z.id);
              }}
            />

            {/* maniglie quadrate: solo se selezionata + modalità trapezio + interattiva */}
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
          </KonvaGroup>
        );
      })}
    </KonvaGroup>
  );
}
