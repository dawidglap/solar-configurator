'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line as KonvaLine,
  Circle as KonvaCircle,
  Text as KonvaText,
  Group as KonvaGroup, // ✅ usare il Group corretto
} from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';
import ScaleIndicator from './ScaleIndicator';

// ---------- helpers ----------
type Pt = { x: number; y: number };

function polygonAreaPx2(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}
function polygonCentroid(pts: Pt[]) {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}
function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const snap       = usePlannerV2Store(s => s.snapshot);
  const view       = usePlannerV2Store(s => s.view);
  const setView    = usePlannerV2Store(s => s.setView);

  const tool       = usePlannerV2Store(s => s.tool);
  const layers     = usePlannerV2Store(s => s.layers);
  const addRoof    = usePlannerV2Store(s => s.addRoof);
  const select     = usePlannerV2Store(s => s.select);
  const selectedId = usePlannerV2Store(s => s.selectedId);

  // carica immagine (snapshot)
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!snap.url) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = snap.url;
    return () => setImg(null);
  }, [snap.url]);

  // osserva dimensioni contenitore
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // fit iniziale (+ centro) → min zoom = fit
  useEffect(() => {
    if (!img || !size.w || !size.h) return;
    const fit = Math.min(size.w / img.naturalWidth, size.h / img.naturalHeight);
    const ox = (size.w - img.naturalWidth * fit) / 2;
    const oy = (size.h - img.naturalHeight * fit) / 2;
    setView({ fitScale: fit, scale: fit, offsetX: ox, offsetY: oy });
  }, [img, size.w, size.h, setView]);

  // clamp offset entro i bordi (no “bordi bianchi”)
  const clampOffset = useCallback((scale: number, ox: number, oy: number) => {
    if (!img) return { x: 0, y: 0 };
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;

    if (sw <= size.w) ox = (size.w - sw) / 2;
    if (sh <= size.h) oy = (size.h - sh) / 2;

    const minX = Math.min(0, size.w - sw);
    const maxX = 0;
    const minY = Math.min(0, size.h - sh);
    const maxY = 0;

    ox = Math.max(minX, Math.min(maxX, ox));
    oy = Math.max(minY, Math.min(maxY, oy));
    return { x: ox, y: oy };
  }, [img, size.w, size.h]);

  const clampScale = useCallback((s: number) => {
    const min = view.fitScale || 1;
    const max = (view.fitScale || 1) * 8;
    return Math.max(min, Math.min(max, s));
  }, [view.fitScale]);

  // zoom wheel ancorato al cursore
  const onWheel = (e: any) => {
    e.evt.preventDefault();
    if (!img) return;

    const stage   = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const old     = view.scale || (view.fitScale || 1);
    const raw     = e.evt.deltaY > 0 ? old / 1.1 : old * 1.1;
    const next    = clampScale(raw);

    const worldX = (pointer.x - (view.offsetX || 0)) / old;
    const worldY = (pointer.y - (view.offsetY || 0)) / old;

    let newOX = pointer.x - worldX * next;
    let newOY = pointer.y - worldY * next;

    const cl = clampOffset(next, newOX, newOY);
    setView({ scale: next, offsetX: cl.x, offsetY: cl.y });
  };

  // pan (solo se immagine > contenitore)
  const canDrag = useMemo(() => {
    const s = view.scale || (view.fitScale || 1);
    if (!img) return false;
    return img.naturalWidth * s > size.w || img.naturalHeight * s > size.h;
  }, [img, size.w, size.h, view.scale, view.fitScale]);

  const onDragMove = (e: any) => {
    const ox = e.target.x();
    const oy = e.target.y();
    const s  = view.scale || (view.fitScale || 1);
    const cl = clampOffset(s, ox, oy);
    e.target.position({ x: cl.x, y: cl.y });
    setView({ offsetX: cl.x, offsetY: cl.y });
  };

  // ---------- Disegno poligono (temporaneo, prima di passare al rettangolo 3-click) ----------
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [mouseImg, setMouseImg] = useState<Pt | null>(null);

  // Stage → Image (px immagine)
  const toImg = useCallback((sx: number, sy: number): Pt => {
    const s = view.scale || (view.fitScale || 1);
    return { x: (sx - (view.offsetX || 0)) / s, y: (sy - (view.offsetY || 0)) / s };
  }, [view.scale, view.fitScale, view.offsetX, view.offsetY]);

  const onStageMouseMove = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    setMouseImg(toImg(pos.x, pos.y));
  };

  const closeIfNearStart = (pts: Pt[], current: Pt) => {
    if (pts.length < 3) return false;
    const thr = 10; // px immagine
    return dist(pts[0], current) <= thr;
  };

  const finishPolygon = (pts: Pt[]) => {
    if (pts.length < 3) { setDrawing(null); return; }
    const id = 'roof_' + Date.now().toString(36);
    const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
    addRoof({ id, name, points: pts });
    select(id);
    setDrawing(null);
  };

  const onStageClick = (e: any) => {
    if (tool !== 'draw-roof') {
      if (e.target === e.target.getStage()) select(undefined);
      return;
    }
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    const p = toImg(pos.x, pos.y);

    setDrawing(prev => {
      if (!prev || prev.length === 0) return [p];
      if (closeIfNearStart(prev, p)) { finishPolygon(prev); return null; }
      return [...prev, p];
    });
  };

  const onStageDblClick = () => {
    if (tool !== 'draw-roof') return;
    if (drawing && drawing.length >= 3) finishPolygon(drawing);
    setDrawing(null);
  };

  // ESC/ENTER shortcut
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (tool !== 'draw-roof') return;
      if (ev.key === 'Escape') setDrawing(null);
      if (ev.key === 'Enter' && drawing && drawing.length >= 3) finishPolygon(drawing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, drawing]);

  const stroke = '#0ea5e9';
  const fill   = 'rgba(14,165,233,0.18)';
  const toFlat = (pts: Pt[]) => pts.flatMap(p => [p.x, p.y]);

  const areaLabel = (pts: Pt[]) => {
    if (!snap.mppImage) return null;
    const areaPx2 = polygonAreaPx2(pts);
    const m2 = areaPx2 * (snap.mppImage * snap.mppImage);
    return `${Math.round(m2)} m²`;
  };

  const cursor = tool === 'draw-roof' ? 'crosshair' : (canDrag ? 'grab' : 'default');
  const layerScale = view.scale || (view.fitScale || 1);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-neutral-50">
      <ScaleIndicator />

      {img && size.w > 0 && size.h > 0 && (
        <Stage
          width={size.w}
          height={size.h}
          x={view.offsetX || 0}
          y={view.offsetY || 0}
          draggable={canDrag && tool !== 'draw-roof'}
          onDragMove={onDragMove}
          onWheel={onWheel}
          onMouseMove={onStageMouseMove}
          onClick={onStageClick}
          onDblClick={onStageDblClick}
          className={cursor === 'grab' ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <Layer scaleX={layerScale} scaleY={layerScale}>
            {/* sfondo immagine */}
            <KonvaImage
              image={img}
              width={img.naturalWidth}
              height={img.naturalHeight}
              listening={false}
            />

            {/* tetti esistenti (solo selezione, nessun drag vertici) */}
            {layers.map((r) => {
              const flat = toFlat(r.points);
              const sel  = r.id === selectedId;
              const c    = polygonCentroid(r.points);
              const label = areaLabel(r.points);
              return (
                <KonvaGroup key={r.id}>
                  <KonvaLine
                    points={flat}
                    closed
                    stroke={stroke}
                    strokeWidth={sel ? 2.5 : 1.5}
                    lineJoin="round"
                    lineCap="round"
                    fill={fill}
                    onClick={() => select(r.id)}
                  />
                  {label && (
                    <KonvaText
                      x={c.x}
                      y={c.y}
                      text={label}
                      fontSize={12}
                      fill="#111"
                      offsetX={18}
                      offsetY={-6}
                      listening={false}
                      // @ts-ignore
                      shadowColor="white"
                      shadowBlur={2}
                      shadowOpacity={0.9}
                    />
                  )}
                </KonvaGroup>
              );
            })}

            {/* rubber band provvisorio (poligono libero) */}
            {tool === 'draw-roof' && drawing && drawing.length > 0 && (
              <>
                <KonvaLine
                  points={toFlat([...drawing, mouseImg ?? drawing[drawing.length - 1]])}
                  stroke={stroke}
                  strokeWidth={1.5}
                  dash={[6, 6]}
                  lineJoin="round"
                  lineCap="round"
                />
                {drawing.map((p, i) => (
                  <KonvaCircle
                    key={i}
                    x={p.x}
                    y={p.y}
                    radius={3.2}
                    fill="#fff"
                    stroke={stroke}
                    strokeWidth={1.2}
                  />
                ))}
                {drawing.length >= 3 && (
                  <KonvaText
                    x={polygonCentroid(drawing).x}
                    y={polygonCentroid(drawing).y}
                    text={areaLabel(drawing) ?? ''}
                    fontSize={12}
                    fill="#111"
                    offsetX={18}
                    offsetY={-6}
                    listening={false}
                    // @ts-ignore
                    shadowColor="white"
                    shadowBlur={2}
                    shadowOpacity={0.9}
                  />
                )}
              </>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
