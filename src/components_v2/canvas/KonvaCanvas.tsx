'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import ScaleBar from '../overlays/ScaleBar';
import Attribution from '../overlays/Attribution';


export default function KonvaCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const { url, width: imgW, height: imgH } = usePlannerV2Store((s) => s.snapshot);
  const setView = usePlannerV2Store((s) => s.setView);
  const view = usePlannerV2Store((s) => s.view);

  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Carica l'immagine quando cambia l'URL
  useEffect(() => {
    if (!url) {
      setImageEl(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setImageEl(img);
    img.src = url;
  }, [url]);

  // Calcola la scala di *fit* e centratura
  const bgTransform = useMemo(() => {
    if (!imageEl || !imageEl.width || !imageEl.height) {
      setView({ scale: 1, offsetX: 0, offsetY: 0 });
      return { scale: 1, x: 0, y: 0 };
    }
    const scale = Math.min(size.w / imageEl.width, size.h / imageEl.height);
    const x = (size.w - imageEl.width * scale) / 2;
    const y = (size.h - imageEl.height * scale) / 2;
    // salva nel negozio per gli overlay metrici (mppCanvas = mppImage/scale)
    setView({ scale, offsetX: x, offsetY: y });
    return { scale, x, y };
  }, [imageEl, size.w, size.h, setView]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <Stage width={size.w} height={size.h}>
        {/* Background layer */}
        <Layer>
          {/* sfondo graduale di default */}
          <Rect
            x={0}
            y={0}
            width={size.w}
            height={size.h}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: size.h }}
            fillLinearGradientColorStops={[0, '#f5f5f5', 1, '#ffffff']}
          />

          {/* immagine se presente */}
          {imageEl && (
            <KImage
              image={imageEl}
              x={bgTransform.x}
              y={bgTransform.y}
              scaleX={bgTransform.scale}
              scaleY={bgTransform.scale}
              listening={false}
            />
          )}

          {/* hint se non c'è immagine */}
          {!imageEl && (
            <Text
              text="Hintergrund: Screenshot/Map (im Eigenschaften-Panel laden)"
              x={16}
              y={16}
              fontSize={14}
              fill="#555"
            />
          )}

          {/* Scale bar (in alto a sinistra per ora) */}
          <ScaleBar meters={5} />
        </Layer>
{/* Overlay attribuzione ancorato in basso a destra */}
<Layer>
  <Group
    x={Math.max(0, size.w - 250)}
    y={Math.max(0, size.h - 30)}
    listening={false}
  >
    <Attribution />
  </Group>
</Layer>
        {/* Future layers: guides, vectors, selections... */}
      </Stage>
    </div>
  );
}
