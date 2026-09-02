// src/components_v2/zones/ZonesLayer.tsx
'use client';
import React, { useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import type { Pt } from '@/types/planner';
import MovableZone from './MovableZone';

export default function ZonesLayer({
  roofId,
  interactive = false,
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
  const ownerRoofPoints = usePlannerV2Store(
    (s) => s.layers.find((roof) => roof.id === roofId)?.points ?? [],
  );
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);

  const zonesForRoof = useMemo(
    () => zones.filter((z) => z.roofId === roofId),
    [zones, roofId]
  );

  if (!zonesForRoof.length) return null;

  return (
    <>
      {zonesForRoof.map((z) => {
        return (
          <MovableZone
            key={z.id}
            zone={z}
            selected={z.id === selectedZoneId}
            interactive={interactive}
            ownerRoofPoints={ownerRoofPoints}
            imgW={imgW}
            imgH={imgH}
            toImg={toImg}
            snapRadiusImg={10 / Math.max(stageScale, 0.01)}
            onSelect={() => setSelectedZone(z.id)}
            onChange={(patch) => updateZone(z.id, patch)}
          />
        );
      })}
    </>
  );
}
