// src/components_v2/canvas/PanelsLayer.tsx
'use client';

import React from 'react';
import PanelsKonva from '../PanelsKonva';
import { usePlannerV2Store } from '../../state/plannerV2Store';

type Pt = { x: number; y: number };
type LayerRoof = { id: string; points: Pt[] };

export default function PanelsLayer({
  layers,
  textureUrl,
  selectedPanelId,   // compat legacy
  onSelect,          // compat legacy (non usato)
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
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);
  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);
  const togglePanelSelection = usePlannerV2Store((s) => s.togglePanelSelection);
  const clearPanelSelection = usePlannerV2Store((s) => s.clearPanelSelection);

  // Supporta selezione additiva (shift/ctrl/cmd)
  const handleSelect = (id?: string, opts?: { additive?: boolean }) => {
    const additive = !!opts?.additive;

    if (!id) {
      clearPanelSelection();
      return;
    }
    if (additive) {
      togglePanelSelection(id);
    } else {
      setSelectedPanels([id]);
    }
  };

  const compatSelectedId = selectedIds[0] ?? selectedPanelId;

  return (
    <>
      {layers.map((r) => (
        <PanelsKonva
          key={`panels-${r.id}`}
          roofId={r.id}
          roofPolygon={r.points}
          textureUrl={textureUrl}
          selectedPanelId={compatSelectedId}
          onSelect={handleSelect}      // ora accetta anche opts.additive
          onDragStart={onAnyDragStart}
          onDragEnd={onAnyDragEnd}
          stageToImg={stageToImg}
        />
      ))}
    </>
  );
}
