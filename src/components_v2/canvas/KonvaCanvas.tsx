'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function KonvaCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const snapshot = usePlannerV2Store((s) => s.snapshot);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <Stage width={size.w} height={size.h}>
        <Layer>
          <Rect
            x={0}
            y={0}
            width={size.w}
            height={size.h}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: size.h }}
            fillLinearGradientColorStops={[0, '#f5f5f5', 1, '#ffffff']}
          />
          {!snapshot.url && (
            <Text
              text="Hintergrund: Screenshot/Map (kommt im nächsten Schritt)"
              x={16}
              y={16}
              fontSize={14}
              fill="#555"
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
