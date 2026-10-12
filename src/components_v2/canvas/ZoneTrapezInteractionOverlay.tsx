'use client';

import { useMemo } from 'react';

import type { Pt } from '@/types/planner';
import type { Zone } from '../state/slices/zonesSlice';
import { history as plannerHistory } from '../state/history';
import { usePlannerV2Store } from '../state/plannerV2Store';
import ZoneHandlesKonva from '../zones/ZoneHandlesKonva';

function stagePxToImgPx(
  toImg: (x: number, y: number) => Pt,
  screenPixels = 1,
) {
  const origin = toImg(0, 0);
  const horizontal = toImg(screenPixels, 0);
  const vertical = toImg(0, screenPixels);
  return Math.max(
    Math.hypot(horizontal.x - origin.x, horizontal.y - origin.y),
    Math.hypot(vertical.x - origin.x, vertical.y - origin.y),
  );
}

/**
 * Only the selected obstacle receives vertex handles. Keeping them in the
 * final geometry layer prevents panels, annotations, and sibling zones from
 * winning the Konva hit test.
 */
export default function ZoneTrapezInteractionOverlay({
  zone,
  ownerRoofPoints,
  imgW,
  imgH,
  toImg,
  onDragStart,
  onDragEnd,
}: {
  zone: Zone;
  ownerRoofPoints: Pt[];
  imgW: number;
  imgH: number;
  toImg: (x: number, y: number) => Pt;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const updateZone = usePlannerV2Store((state) => state.updateZone);
  const snapRadiusImg = useMemo(() => 10 * stagePxToImgPx(toImg), [toImg]);

  return (
    <ZoneHandlesKonva
      points={zone.points}
      ownerRoofPoints={ownerRoofPoints}
      imgW={imgW}
      imgH={imgH}
      toImg={toImg}
      snapRadiusImg={snapRadiusImg}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onChange={(points) => {
        plannerHistory.push('move reserved zone vertex');
        updateZone(zone.id, { points, shapeKind: 'polygon' });
      }}
    />
  );
}
