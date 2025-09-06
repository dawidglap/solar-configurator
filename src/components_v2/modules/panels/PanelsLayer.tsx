'use client';

import React from 'react';
import PanelsKonva from '../PanelsKonva';



type Pt = { x: number; y: number };
type LayerRoof = { id: string; points: Pt[] };

export default function PanelsLayer({
  layers,
  textureUrl,
  selectedPanelId,
  onSelect,
  stageToImg,
  onAnyDragStart,
  onAnyDragEnd,
}: {
  layers: LayerRoof[];
  textureUrl?: string;
  selectedPanelId?: string;
  onSelect?: (id?: string) => void;
  stageToImg?: (x: number, y: number) => Pt;
  onAnyDragStart?: () => void;
  onAnyDragEnd?: () => void;
}) {
  return (
    <>
      {layers.map((r) => (
        <PanelsKonva
          key={`panels-${r.id}`}
          roofId={r.id}
          roofPolygon={r.points}
          textureUrl={textureUrl}
          selectedPanelId={selectedPanelId}
          onSelect={onSelect}
          onDragStart={onAnyDragStart}
          onDragEnd={onAnyDragEnd}
          stageToImg={stageToImg}
        />
      ))}
    </>
  );
}
