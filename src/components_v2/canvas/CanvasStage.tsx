'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import ScaleIndicator from '../canvas/ScaleIndicator';

function useImage(url?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = url;
    return () => setImg(null);
  }, [url]);
  return img;
}

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const snap = usePlannerV2Store(s => s.snapshot);
  const view = usePlannerV2Store(s => s.view);
  const setView = usePlannerV2Store(s => s.setView);

  const img = useImage(snap.url);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Calcolo fit + centra quando c'è un'immagine o cambia il container
  useEffect(() => {
    if (!img || !size.w || !size.h) return;
    const fit = Math.min(size.w / img.naturalWidth, size.h / img.naturalHeight);
    const ox = (size.w - img.naturalWidth * fit) / 2;
    const oy = (size.h - img.naturalHeight * fit) / 2;
    setView({ fitScale: fit, scale: fit, offsetX: ox, offsetY: oy });
  }, [img, size.w, size.h, setView]);

  // Helpers di clamp
  const clampOffset = (scale: number, ox: number, oy: number) => {
    if (!img) return { x: 0, y: 0 };
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;

    // se l'immagine (scalata) è più piccola del container, centrala
    if (sw <= size.w) ox = (size.w - sw) / 2;
    if (sh <= size.h) oy = (size.h - sh) / 2;

    const minX = Math.min(0, size.w - sw);
    const maxX = 0;
    const minY = Math.min(0, size.h - sh);
    const maxY = 0;

    ox = Math.max(minX, Math.min(maxX, ox));
    oy = Math.max(minY, Math.min(maxY, oy));
    return { x: ox, y: oy };
  };

  const clampScale = (s: number) => {
    const min = view.fitScale || 1;       // mai meno del fit
    const max = min * 8;                  // limite superiore (8x)
    return Math.max(min, Math.min(max, s));
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    if (!img || !size.w || !size.h) return;

    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();

    const oldScale = view.scale || (view.fitScale || 1);
    const scaleBy = 1.1;
    const raw = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const newScale = clampScale(raw);

    // punto del mondo sotto il mouse prima dello zoom
    const worldX = (pointer.x - (view.offsetX || 0)) / oldScale;
    const worldY = (pointer.y - (view.offsetY || 0)) / oldScale;

    // nuovo offset per zoom sul puntatore
    let newOX = pointer.x - worldX * newScale;
    let newOY = pointer.y - worldY * newScale;

    const clamped = clampOffset(newScale, newOX, newOY);
    setView({ scale: newScale, offsetX: clamped.x, offsetY: clamped.y });
  };

  const handleDragMove = (e: any) => {
    const ox = e.target.x();
    const oy = e.target.y();
    const clamped = clampOffset(view.scale || (view.fitScale || 1), ox, oy);
    // correzione visiva immediata
    e.target.position({ x: clamped.x, y: clamped.y });
    setView({ offsetX: clamped.x, offsetY: clamped.y });
  };

  const scaled = useMemo(() => {
    const scale = view.scale || (view.fitScale || 1);
    const w = img ? img.naturalWidth * scale : 0;
    const h = img ? img.naturalHeight * scale : 0;
    return { w, h, scale };
  }, [img, view.scale, view.fitScale]);

  const stageProps = useMemo(() => ({
    width: size.w,
    height: size.h,
    x: view.offsetX || 0,
    y: view.offsetY || 0,
    draggable: scaled.w > size.w || scaled.h > size.h, // pan solo se ha senso
    onDragMove: handleDragMove,
    onWheel: handleWheel,
  }), [size, view.offsetX, view.offsetY, handleWheel, scaled.w, scaled.h]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-neutral-50">
      <ScaleIndicator />
      {img && size.w > 0 && size.h > 0 && (
        <Stage {...stageProps} className="cursor-grab active:cursor-grabbing">
          <Layer scaleX={scaled.scale} scaleY={scaled.scale}>
            <KonvaImage
              image={img}
              width={img.naturalWidth}
              height={img.naturalHeight}
              listening={false}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
