'use client';
import { Rect, Group } from 'react-konva';
import { plannerModuleVisual, plannerTheme } from '../theme/plannerTheme';

type Props = {
  x: number; y: number;               // centro modulo in px immagine
  w: number; h: number;               // dimensioni in px immagine
  rotationDeg?: number;               // rotazione intorno al centro
  selected?: boolean;
};

export default function ModuleSprite({ x, y, w, h, rotationDeg = 0, selected }: Props) {
  // offset per ruotare intorno al centro
  const ox = w / 2, oy = h / 2;

  return (
    <Group x={x} y={y} rotation={rotationDeg} offsetX={ox} offsetY={oy} listening={false}>
      <Rect
        x={0} y={0} width={w} height={h}
        cornerRadius={2}
        stroke={selected ? plannerTheme.panelSelected : plannerModuleVisual.frame}
        strokeWidth={selected ? 1.2 : 0.6}
        fill={plannerModuleVisual.surface}
      />
    </Group>
  );
}
