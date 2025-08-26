'use client';

import React from 'react';
import { Line as KonvaLine } from 'react-konva';
import { Group as KonvaGroup } from 'react-konva';

import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x:number; y:number };
const toFlat = (pts: Pt[]) => pts.flatMap(p => [p.x, p.y]);

export default function SonnendachOverlayKonva() {
  const detected = usePlannerV2Store(s => s.detectedRoofs);
  const addRoof  = usePlannerV2Store(s => s.addRoof);
  const select   = usePlannerV2Store(s => s.select);

  if (!detected || detected.length === 0) return null;

return (
  <>
    {detected.map((d, idx) => (
      <KonvaGroup
        key={d.id}
        onMouseEnter={e => e.target.getStage()?.container().style.setProperty('cursor', 'pointer')}
        onMouseLeave={e => e.target.getStage()?.container().style.setProperty('cursor', 'default')}
        onClick={() => {
          const id = 'roof_' + Date.now().toString(36);
          const name = `Dach ${idx + 1} (Sonnendach)`;
          addRoof({
            id, name,
            points: d.points,
            tiltDeg: d.tiltDeg,
            azimuthDeg: d.azimuthDeg,
            source: 'sonnendach',
          });
          select(id);
        }}
      >
        {/* BG bianco semi-trasparente (non riceve eventi) */}
        <KonvaLine
          points={toFlat(d.points)}
          closed
          fill="rgba(255, 255, 255, 0.25)"   // <-- opacità regolabile
          strokeEnabled={false}
          listening={false}
          shadowColor="black"
          shadowBlur={2}
          shadowOpacity={0.08}
        />

        {/* bordo tratteggiato sopra il bg (cliccabile) */}
        <KonvaLine
          points={toFlat(d.points)}
          closed
          stroke="#ffffff"
          strokeWidth={1}
          dash={[8, 6]}
          lineJoin="round"
          lineCap="round"
        />
      </KonvaGroup>
    ))}
  </>
);

}
