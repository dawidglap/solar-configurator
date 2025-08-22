'use client';

import { Group, Rect, Text } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function ScaleBar({
  meters = 5,
  margin = 16,
}: { meters?: number; margin?: number }) {
  const { mppImage } = usePlannerV2Store((s) => s.snapshot);
  const scale = usePlannerV2Store((s) => s.view.scale);

  if (!mppImage || !scale) return null;

  // metri per *canvas* pixel = mppImage / scale
  const mppCanvas = mppImage / scale;
  const px = Math.max(1, Math.round(meters / mppCanvas)); // lunghezza barra in px

  const height = 8;

  return (
    <Group x={margin} y={margin}>
      <Rect width={px} height={height} fill="#111" opacity={0.8} cornerRadius={2} />
      <Text
        text={`${meters} m`}
        x={0}
        y={height + 6}
        fontSize={12}
        fill="#222"
        opacity={0.9}
      />
    </Group>
  );
}
