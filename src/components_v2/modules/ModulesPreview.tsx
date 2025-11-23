// components_v2/modules/ModulesPreview.tsx
'use client';

import React, { useMemo } from 'react';
import { Group, Rect, Line, Image as KonvaImage } from 'react-konva';
import { computeAutoLayoutRects } from './layout';      // ← stessa cartella
import { overlapsReservedRect, overlapsSnowGuard } from '../zones/utils';

type Pt = { x: number; y: number };
type Anchor = 'start' | 'center' | 'end';

type Props = {
  roofId: string;
  polygon: Pt[];                           // px immagine
  mppImage: number;                        // metri/px
  azimuthDeg?: number;                     // 0=N(↑), 90=E(→)
  orientation: 'portrait' | 'landscape';
  panelSizeM: { w: number; h: number };    // metri (w=lato corto, h=lato lungo)
  spacingM: number;                        // metri fra moduli
  marginM: number;                         // metri bordo falda
  showGrid?: boolean;
  textureUrl?: string;

  // controlli di allineamento/origine griglia
  phaseX?: number;
  phaseY?: number;
  anchorX?: Anchor;
  anchorY?: Anchor;

  // copertura lungo Y (righe): 0.5, 0.75, 1 …
  coverageRatio?: number;
};

/* ───────── helpers geometrici SOLO per la GRIGLIA VISIVA ───────── */
const deg2rad = (d: number) => (d * Math.PI) / 180;
function centroid(poly: Pt[]) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  const n = Math.max(1, poly.length);
  return { x: x / n, y: y / n };
}
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function rot(p: Pt, theta: number): Pt {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt { return rot(sub(p, O), -theta); }
function localToWorld(p: Pt, O: Pt, theta: number): Pt { return add(rot(p, theta), O); }
function signedArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
}
function cross(a: Pt, b: Pt) { return a.x * b.y - a.y * b.x; }
/** Offset interno per poligoni **convessi**. Se degenerato → null. */
function insetConvexPolygon(poly: Pt[], inset: number): Pt[] | null {
  const n = poly.length;
  if (n < 3 || inset <= 0) return poly.slice();

  const area = signedArea(poly);
  const inwardRight = area > 0;

  const shiftedP: Pt[] = new Array(n);
  const dir: Pt[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % n];
    const d = { x: p1.x - p0.x, y: p1.y - p0.y };
    const L = Math.hypot(d.x, d.y) || 1;
    const nx = inwardRight ? d.y / L : -d.y / L;
    const ny = inwardRight ? -d.x / L : d.x / L;
    dir[i] = d;
    shiftedP[i] = { x: p0.x + nx * inset, y: p0.y + ny * inset };
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = shiftedP[i], r = dir[i];
    const q = shiftedP[j], s = dir[j];
    const rxs = cross(r, s);
    if (Math.abs(rxs) < 1e-6) return null;
    const t = cross({ x: q.x - p.x, y: q.y - p.y }, s) / rxs;
    out.push({ x: p.x + r.x * t, y: p.y + r.y * t });
  }
  return out;
}
const normPhase = (p: number) => {
  if (!isFinite(p)) return 0;
  let r = p % 1;
  if (r < 0) r += 1;
  return r;
};
/* ──────────────────────────────────────────────────────────────── */

export default function ModulesPreview({
  roofId,
  polygon,
  mppImage,
  azimuthDeg,
  orientation,
  panelSizeM,
  spacingM,
  marginM,
  showGrid = true,
  textureUrl = '/images/panel.webp',
  phaseX = 0,
  phaseY = 0,
  anchorX = 'start',
  anchorY = 'start',
  coverageRatio = 1,
}: Props) {
  // 1) Calcolo ufficiale dei rettangoli (stessa funzione usata al commit)
  const rectsAll = useMemo(() => {
    if (!polygon?.length || !mppImage) return [];
    return computeAutoLayoutRects({
      polygon,
      mppImage,
      azimuthDeg,
      orientation,
      panelSizeM,
      spacingM,
      marginM,
      phaseX,
      phaseY,
      anchorX,
      anchorY,
      coverageRatio, // ← preview rispetta 1/2, 3/4, 1/1
    });
  }, [
    polygon, mppImage, azimuthDeg, orientation, panelSizeM,
    spacingM, marginM, phaseX, phaseY, anchorX, anchorY, coverageRatio,
  ]);

  // 2) Filtro zone riservate + schneefang (coerente con FillAreaController + U)
  const rects = useMemo(
    () =>
      rectsAll.filter((r) => {
        const rectForReserved = {
          cx: r.cx,
          cy: r.cy,
          w: r.wPx,
          h: r.hPx,
          angleDeg: r.angleDeg,
        };

        const rectForSnow = {
          cx: r.cx,
          cy: r.cy,
          wPx: r.wPx,
          hPx: r.hPx,
          angleDeg: r.angleDeg,
        };

        // se entra in una hindernis → scarta
        if (overlapsReservedRect(rectForReserved, roofId, 1)) return false;

        // se interseca una linea neve → scarta
        if (overlapsSnowGuard(rectForSnow, roofId, 1)) return false;

        return true;
      }),
    [rectsAll, roofId]
  );

  // 3) Griglia visiva (linee) — calcolata con la stessa logica di anchor/phase
  const gridLinesWorld = useMemo(() => {
    if (!showGrid || !polygon?.length || !mppImage) return [];

    // frame locale
    const theta = typeof azimuthDeg === 'number' ? deg2rad(azimuthDeg) : 0;
    const O = centroid(polygon);

    const px = (m: number) => m / mppImage;
    const panelW = px(orientation === 'portrait' ? panelSizeM.w : panelSizeM.h);
    const panelH = px(orientation === 'portrait' ? panelSizeM.h : panelSizeM.w);
    const gap    = px(spacingM);
    const marginPx = Math.max(0, px(marginM));

    // poligono locale + margine
    const polyLocal = polygon.map(p => worldToLocal(p, O, theta));
    const clipLocal = insetConvexPolygon(polyLocal, marginPx) ?? polyLocal;

    // bbox locale
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of clipLocal) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return [];

    const cellW = panelW + gap;
    const cellH = panelH + gap;
    const spanX = maxX - minX;
    const spanY = maxY - minY;

    // stima col/row per anchor
    const maxCols = Math.max(0, Math.floor((spanX - panelW + 1e-6) / cellW) + 1);
    const maxRows = Math.max(0, Math.floor((spanY - panelH + 1e-6) / cellH) + 1);

    const usedW = maxCols > 0 ? (maxCols * panelW + (maxCols - 1) * gap) : 0;
    const usedH = maxRows > 0 ? (maxRows * panelH + (maxRows - 1) * gap) : 0;
    const remX  = Math.max(0, spanX - usedW);
    const remY  = Math.max(0, spanY - usedH);

    const anchorOffsetX =
      anchorX === 'end' ? remX : anchorX === 'center' ? remX / 2 : 0;
    const anchorOffsetY =
      anchorY === 'end' ? remY : anchorY === 'center' ? remY / 2 : 0;

    const phx = normPhase(phaseX);
    const phy = normPhase(phaseY);
    const startX = minX + anchorOffsetX + phx * cellW;
    const startY = minY + anchorOffsetY + phy * cellH;

    const lines: { points: number[] }[] = [];

    // verticali
    for (let x = startX; x <= maxX + 0.5; x += cellW) {
      const a = localToWorld({ x, y: minY }, O, theta);
      const b = localToWorld({ x, y: maxY }, O, theta);
      lines.push({ points: [a.x, a.y, b.x, b.y] });
    }
    for (let x = startX - cellW; x >= minX - 0.5; x -= cellW) {
      const a = localToWorld({ x, y: minY }, O, theta);
      const b = localToWorld({ x, y: maxY }, O, theta);
      lines.push({ points: [a.x, a.y, b.x, b.y] });
    }

    // orizzontali
    for (let y = startY; y <= maxY + 0.5; y += cellH) {
      const a = localToWorld({ x: minX, y }, O, theta);
      const b = localToWorld({ x: maxX, y }, O, theta);
      lines.push({ points: [a.x, a.y, b.x, b.y] });
    }
    for (let y = startY - cellH; y >= minY - 0.5; y -= cellH) {
      const a = localToWorld({ x: minX, y }, O, theta);
      const b = localToWorld({ x: maxX, y }, O, theta);
      lines.push({ points: [a.x, a.y, b.x, b.y] });
    }

    return lines;
  }, [
    showGrid, polygon, mppImage, azimuthDeg, orientation,
    panelSizeM, spacingM, marginM, phaseX, phaseY, anchorX, anchorY,
  ]);

  // 4) texture opzionale
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // 5) render con clip al poligono
  return (
    <Group
      listening={false}
      clipFunc={(ctx) => {
        if (!polygon.length) return;
        ctx.beginPath();
        ctx.moveTo(polygon[0].x, polygon[0].y);
        for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
        ctx.closePath();
      }}
    >
      {/* griglia visiva */}
      {showGrid && gridLinesWorld.map((g, i) => (
        <Line
          key={`g-${i}`}
          points={g.points}
          stroke="#0769e9"
          opacity={0.3}
          strokeWidth={0.35}
          listening={false}
        />
      ))}

      {/* moduli (preview = commit, ma filtrati da hindernis + snow-guard) */}
      {rects.map((r, i) =>
        img ? (
          <KonvaImage
            key={i}
            image={img}
            x={r.cx}
            y={r.cy}
            width={r.wPx}
            height={r.hPx}
            offsetX={r.wPx / 2}
            offsetY={r.hPx / 2}
            rotation={r.angleDeg}
            listening={false}
            opacity={0.85}
          />
        ) : (
          <Rect
            key={i}
            x={r.cx}
            y={r.cy}
            width={r.wPx}
            height={r.hPx}
            offsetX={r.wPx / 2}
            offsetY={r.hPx / 2}
            rotation={r.angleDeg}
            fill="#2b4b7c"
            opacity={0.85}
            listening={false}
          />
        )
      )}
    </Group>
  );
}
