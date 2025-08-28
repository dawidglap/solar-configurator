'use client';

import React from 'react';
import { Group as KonvaGroup, Line as KonvaLine, Text as KonvaText } from 'react-konva';
import RoofHandlesKonva from './RoofHandlesKonva';
import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };
type LayerRoof = { id: string; points: Pt[] };

function toFlat(pts: Pt[]) {
  return pts.flatMap((p) => [p.x, p.y]);
}
function centroid(pts: Pt[]) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const n = pts.length || 1;
  return { x: sx / n, y: sy / n };
}

export default function RoofShapesLayer({
  layers,
  selectedId,
  onSelect,
  showAreaLabels,
  stroke,
  strokeSelected,
  fill,
  strokeWidthNormal,
  strokeWidthSelected,
  shapeMode,
  toImg,
  imgW,
  imgH,
  onHandlesDragStart,
  onHandlesDragEnd,
  areaLabel,
}: {
  layers: LayerRoof[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  showAreaLabels: boolean;
  stroke: string;
  strokeSelected: string;
  fill: string;
  strokeWidthNormal: number;
  strokeWidthSelected: number;
  shapeMode: 'normal' | 'trapezio';
  toImg: (x: number, y: number) => Pt;
  imgW: number;
  imgH: number;
  onHandlesDragStart: () => void;
  onHandlesDragEnd: () => void;
  areaLabel: (pts: Pt[]) => string | null;
}) {
  const updateRoof = usePlannerV2Store((s) => s.updateRoof);

  return (
    <>
      {layers.map((r) => {
        const flat = toFlat(r.points);
        const sel = r.id === selectedId;
        const c = centroid(r.points);
        const label = showAreaLabels ? areaLabel(r.points) : null;

        return (
          <KonvaGroup key={r.id}>
            <KonvaLine
              points={flat}
              closed
              stroke={sel ? strokeSelected : stroke}
              strokeWidth={sel ? strokeWidthSelected : strokeWidthNormal}
              lineJoin="round"
              lineCap="round"
              fill={fill}
              onClick={() => onSelect(r.id)}
              shadowColor={sel ? strokeSelected : 'transparent'}
              shadowBlur={sel ? 6 : 0}
              shadowOpacity={sel ? 0.9 : 0}
            />

            {showAreaLabels && label && (
              <KonvaText
                x={c.x}
                y={c.y}
                text={label}
                fontSize={12}
                fill="#111"
                offsetX={18}
                offsetY={-6}
                listening={false}
                shadowColor="white"
                shadowBlur={2}
                shadowOpacity={0.9}
              />
            )}

            {/* Maniglie: SOLO quando selezionato + modalità Trapezio */}
            {sel && shapeMode === 'trapezio' && (
              <RoofHandlesKonva
                points={r.points}
                imgW={imgW}
                imgH={imgH}
                toImg={toImg}
                onDragStart={onHandlesDragStart}
                onDragEnd={onHandlesDragEnd}
                onChange={(next) => updateRoof(r.id, { points: next })}
              />
            )}
          </KonvaGroup>
        );
      })}
    </>
  );
}
