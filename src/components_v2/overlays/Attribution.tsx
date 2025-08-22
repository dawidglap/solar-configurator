'use client';

import { Group, Rect, Text } from 'react-konva';

export default function Attribution() {
  const padding = 6;
  const bgW = 240, bgH = 22;

  return (
    <Group>
      <Rect
        x={0}
        y={0}
        width={bgW}
        height={bgH}
        fill="#fff"
        opacity={0.85}
        cornerRadius={6}
        shadowBlur={2}
      />
      <Text
        text="© MapTiler  © OpenStreetMap contributors"
        x={padding}
        y={padding - 2}
        fontSize={12}
        fill="#333"
      />
    </Group>
  );
}
