'use client';

import React from 'react';
import { Line as KonvaLine } from 'react-konva';

export const Guides: React.FC<{
  hintU: number[] | null;
  hintV: number[] | null;
}> = ({ hintU, hintV }) => {
  return (
    <>
      {hintU && (
        <KonvaLine
          points={hintU}
          stroke="#D3DAD9"
          dash={[1, 1]}
          strokeWidth={0.3}
          opacity={0.6}
          listening={false}
        />
      )}
      {hintV && (
        <KonvaLine
          points={hintV}
          stroke="#D3DAD9"
          dash={[1, 1]}
          strokeWidth={0.3}
          opacity={0.6}
          listening={false}
        />
      )}
    </>
  );
};
