'use client';

import React from 'react';
import { Line as KonvaLine } from 'react-konva';
import type Konva from 'konva';
import { plannerTheme } from '../../theme/plannerTheme';

export const Guides: React.FC<{
  hintU?: number[] | null;
  hintV?: number[] | null;
  hintURef?: React.Ref<Konva.Line>;
  hintVRef?: React.Ref<Konva.Line>;
}> = ({ hintU = null, hintV = null, hintURef, hintVRef }) => {
  return (
    <>
      <KonvaLine
          ref={hintURef}
          points={hintU ?? []}
          visible={Boolean(hintU)}
          stroke={plannerTheme.guideLine}
          dash={[1, 1]}
          strokeWidth={0.3}
          opacity={0.6}
          listening={false}
        />
      <KonvaLine
          ref={hintVRef}
          points={hintV ?? []}
          visible={Boolean(hintV)}
          stroke={plannerTheme.guideLine}
          dash={[1, 1]}
          strokeWidth={0.3}
          opacity={0.6}
          listening={false}
        />
    </>
  );
};
