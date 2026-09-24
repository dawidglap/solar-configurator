'use client';

import { useMemo } from 'react';
import type { Pt, RoofArea } from '@/types/planner';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history as plannerHistory } from '../state/history';
import RoofHandlesKonva from './RoofHandlesKonva';

type SnapTarget = { roofId: string; index: number; x: number; y: number };

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
 * The active Trapez handles live in their own final Konva layer. Keeping this
 * overlay separate from each roof group guarantees that later roofs, labels,
 * zones and panels can never win the hit test at an overlapping vertex.
 */
export default function RoofTrapezInteractionOverlay({
  roof,
  roofs,
  imgW,
  imgH,
  toImg,
  onDragStart,
  onDragEnd,
}: {
  roof: RoofArea;
  roofs: RoofArea[];
  imgW: number;
  imgH: number;
  toImg: (x: number, y: number) => Pt;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const snapRadiusImg = useMemo(
    () => 6 * stagePxToImgPx(toImg),
    [toImg],
  );
  const snapTargets = useMemo<SnapTarget[]>(
    () => roofs.flatMap((candidate) => candidate.points.map((point, index) => ({
      roofId: candidate.id,
      index,
      x: point.x,
      y: point.y,
    }))),
    [roofs],
  );
  const getSnapTargets = useMemo(() => () => snapTargets, [snapTargets]);

  return (
    <RoofHandlesKonva
      roofId={roof.id}
      points={roof.points}
      imgW={imgW}
      imgH={imgH}
      toImg={toImg}
      getSnapTargets={getSnapTargets}
      snapRadiusImg={snapRadiusImg}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onChange={(points) => {
        plannerHistory.push('move roof vertex');
        updateRoof(roof.id, { points });
      }}
    />
  );
}
