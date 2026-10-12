// src/components_v2/zones/ZonesLayer.tsx
'use client';
import React, { useMemo } from 'react';
import type Konva from 'konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import type { Pt } from '@/types/planner';
import MovableZone from './MovableZone';
import { resolveRoofLocalPointerAction } from '../canvas/interactionPolicy';

export default function ZonesLayer({
  roofId,
  interactive = false,
  toImg,
}: {
  roofId: string;
  interactive?: boolean;
  toImg: (sx: number, sy: number) => Pt;
}) {
  const zones = usePlannerV2Store((s) => s.zones);
  const selectedZoneId = usePlannerV2Store((s) => s.selectedZoneId);
  const setSelectedZone = usePlannerV2Store((s) => s.setSelectedZone);
  const updateZone = usePlannerV2Store((s) => s.updateZone);
  const ownerRoofPoints = usePlannerV2Store(
    (s) => s.layers.find((roof) => roof.id === roofId)?.points ?? [],
  );
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);

  const routeOwnerRoof = React.useCallback((event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const state = usePlannerV2Store.getState();
    const action = resolveRoofLocalPointerAction({
      ownerRoofId: roofId,
      selectedRoofId: state.selectedId,
      button: 'button' in event.evt ? event.evt.button : undefined,
      tool: state.tool,
    });
    if (action === 'ignore-non-primary') return 'ignore' as const;
    if (action === 'preserve-explicit-tool') return 'ignore' as const;
    if (action === 'switch-roof') {
      state.select(roofId);
      return 'consume' as const;
    }
    return 'continue' as const;
  }, [roofId]);

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
            toImg={toImg}
            stageScale={stageScale}
            onSelect={() => setSelectedZone(z.id)}
            onRoutePointerDown={routeOwnerRoof}
            onChange={(patch) => updateZone(z.id, patch)}
          />
        );
      })}
    </>
  );
}
