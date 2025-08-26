// components_v2/modules/ModulesPreview.tsx
'use client';

import React, { useMemo } from 'react';
import { Group, Rect, Image as KonvaImage } from 'react-konva';

type Pt = { x: number; y: number };

function signedArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
}
function centroid(poly: Pt[]) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  const n = Math.max(1, poly.length);
  return { x: x / n, y: y / n };
}
function cross(a: Pt, b: Pt) { return a.x * b.y - a.y * b.x; }
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Pt, k: number): Pt { return { x: a.x * k, y: a.y * k }; }

function rot(p: Pt, theta: number): Pt {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
  // ruota di -theta intorno a O
  return rot(sub(p, O), -theta);
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
  // ruota di +theta e riporta intorno a O
  return add(rot(p, theta), O);
}

/** Offset verso l’interno di un poligono convesso (px). Fallback null se degenerato. */
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

    const t = cross(sub(q, p), s) / rxs;
    out.push(add(p, mul(r, t)));
  }
  return out;
}

function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const inter = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}
function rectCornersTL(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Angolo del bordo più lungo del poligono (radians). */
function longestEdgeAngle(poly: Pt[]) {
  let bestLen = -1, bestTheta = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.hypot(vx, vy);
    if (len > bestLen) {
      bestLen = len;
      bestTheta = Math.atan2(vy, vx);
    }
  }
  return bestTheta;
}

export default function ModulesPreview(props: {
  polygon: Pt[];
  mppImage: number;
  panelSizeM: { w: number; h: number };
  spacingM: number;
  marginM: number;
  orientation: 'portrait' | 'landscape';
  azimuthDeg?: number;   // riservato per future rotazioni “fisiche”
  textureUrl?: string;
}) {
  const {
    polygon, mppImage, panelSizeM, spacingM, marginM, orientation, textureUrl,
  } = props;

  // metri → pixel
  const px = (m: number) => m / mppImage;
  const panelW = px(orientation === 'portrait' ? panelSizeM.w : panelSizeM.h);
  const panelH = px(orientation === 'portrait' ? panelSizeM.h : panelSizeM.w);
  const gap = px(spacingM);
  const marginPx = Math.max(0, px(marginM));

  // 1) definiamo asse della griglia: bordo più lungo del tetto
  const theta = useMemo(() => longestEdgeAngle(polygon), [polygon]); // rad
  const thetaDeg = (theta * 180) / Math.PI;

  // 2) origine per il sistema locale ruotato
  const O = useMemo(() => centroid(polygon), [polygon]);

  // 3) poligono in coordinate locali (ruotato in modo che l’edge “di riferimento” sia orizzontale)
  const polyLocal = useMemo(
    () => polygon.map(p => worldToLocal(p, O, theta)),
    [polygon, O, theta]
  );

  // 4) margine reale su poligono locale (convesso)
  const clipLocal = useMemo(() => {
    const inset = insetConvexPolygon(polyLocal, marginPx);
    return inset ?? polyLocal;
  }, [polyLocal, marginPx]);

  // 5) bbox locale
  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of clipLocal) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }, [clipLocal]);

  // 6) genera griglia in locale; accetta solo rettangoli completamente dentro clipLocal
  const rectsWorld = useMemo(() => {
    const out: { cx: number; cy: number; w: number; h: number }[] = [];
    if (!isFinite(bbox.minX)) return out;

    for (let y = bbox.minY; y + panelH <= bbox.maxY + 1e-6; y += panelH + gap) {
      for (let x = bbox.minX; x + panelW <= bbox.maxX + 1e-6; x += panelW + gap) {
        const corners = rectCornersTL(x, y, panelW, panelH);
        if (corners.every(pt => pointInPoly(pt, clipLocal))) {
          // centro locale → mondo
          const cx = x + panelW / 2;
          const cy = y + panelH / 2;
          const Cw = localToWorld({ x: cx, y: cy }, O, theta);
          out.push({ cx: Cw.x, cy: Cw.y, w: panelW, h: panelH });
        }
      }
    }
    return out;
  }, [bbox, panelW, panelH, gap, clipLocal, O, theta]);

  // 7) texture opzionale
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // Clip nel mondo (poligono originale) – ok anche con rettangoli ruotati
  return (
    <Group
      listening={false}
      clipFunc={(ctx) => {
        ctx.beginPath();
        ctx.moveTo(polygon[0].x, polygon[0].y);
        for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
        ctx.closePath();
      }}
    >
      {rectsWorld.map((r, i) =>
        img ? (
          <KonvaImage
            key={i}
            image={img}
            x={r.cx}
            y={r.cy}
            width={r.w}
            height={r.h}
            offsetX={r.w / 2}
            offsetY={r.h / 2}
            rotation={thetaDeg}
            listening={false}
            opacity={1}
          />
        ) : (
          <Rect
            key={i}
            x={r.cx}
            y={r.cy}
            width={r.w}
            height={r.h}
            offsetX={r.w / 2}
            offsetY={r.h / 2}
            rotation={thetaDeg}
            fill="#2b4b7c"
            opacity={0.85}
            listening={false}
          />
        )
      )}
    </Group>
  );
}
