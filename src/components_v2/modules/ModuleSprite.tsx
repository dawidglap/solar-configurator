'use client';
import { Rect, Group } from 'react-konva';
import { usePanelTexture } from './PanelTexture';

type Props = {
  x: number; y: number;               // centro modulo in px immagine
  w: number; h: number;               // dimensioni in px immagine
  rotationDeg?: number;               // rotazione intorno al centro
  textureUrl?: string;                // immagine opzionale
  selected?: boolean;
};

export default function ModuleSprite({ x, y, w, h, rotationDeg = 0, textureUrl, selected }: Props) {
  const img = usePanelTexture(textureUrl);
  const hasTex = !!img;

  // offset per ruotare intorno al centro
  const ox = w / 2, oy = h / 2;

  return (
    <Group x={x} y={y} rotation={rotationDeg} offsetX={ox} offsetY={oy} listening={false}>
      <Rect
        x={0} y={0} width={w} height={h}
        cornerRadius={2}
        stroke={selected ? '#ef4444' : '#111'}
        strokeWidth={selected ? 1.2 : 0.6}
        fill={!hasTex ? 'rgba(17,17,17,0.92)' : undefined}
        // texture: no-repeat e scala per coprire esattamente il rettangolo
        fillPatternImage={img ?? undefined}
        fillPatternScaleX={img ? (w / img.naturalWidth) : undefined}
        fillPatternScaleY={img ? (h / img.naturalHeight) : undefined}
        fillPatternRepeat={img ? 'no-repeat' : undefined}
      />
      {/* sottili “celle” per dare profondità anche senza texture */}
      {!hasTex && (
        <>
          <Rect x={4} y={4} width={w-8} height={h-8} stroke="rgba(255,255,255,0.08)" strokeWidth={0.6}/>
          <Rect x={8} y={8} width={w-16} height={h-16} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}/>
        </>
      )}
    </Group>
  );
}
