// src/components_v2/modules/layout.ts
export type Pt = { x: number; y: number };

const deg2rad = (d: number) => (d * Math.PI) / 180;

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
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function rot(p: Pt, theta: number): Pt {
    const c = Math.cos(theta), s = Math.sin(theta);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt {
    return rot(sub(p, O), -theta);
}
function localToWorld(p: Pt, O: Pt, theta: number): Pt {
    return add(rot(p, theta), O);
}
function cross(a: Pt, b: Pt) { return a.x * b.y - a.y * b.x; }

function pointInPoly(p: Pt, poly: Pt[]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const inter = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
        if (inter) inside = !inside;
    }
    return inside;
}
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
/** Angolo dell’edge più lungo (rad) nel mondo. */
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

export type AutoRect = { cx: number; cy: number; wPx: number; hPx: number; angleDeg: number };

/** Calcola i rettangoli modulo “auto-layout” (centro+size in px, angolo in °). */
export function computeAutoLayoutRects(args: {
    polygon: Pt[];
    mppImage: number;
    azimuthDeg?: number;                       // se assente → usa edge più lungo
    orientation: 'portrait' | 'landscape';
    panelSizeM: { w: number; h: number };
    spacingM: number;
    marginM: number;
}): AutoRect[] {
    const { polygon, mppImage, azimuthDeg, orientation, panelSizeM, spacingM, marginM } = args;
    if (!polygon.length || !mppImage) return [];

    // m → px
    const px = (m: number) => m / mppImage;
    const wPx = px(orientation === 'portrait' ? panelSizeM.w : panelSizeM.h);
    const hPx = px(orientation === 'portrait' ? panelSizeM.h : panelSizeM.w);
    const gap = px(spacingM);
    const marginPx = Math.max(0, px(marginM));

    const theta = typeof azimuthDeg === 'number' ? deg2rad(azimuthDeg) : longestEdgeAngle(polygon);
    const angleDeg = theta * 180 / Math.PI;
    const O = centroid(polygon);

    // locale ruotato
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

    const out: AutoRect[] = [];
    for (let y = minY; y + hPx <= maxY + 1e-6; y += hPx + gap) {
        for (let x = minX; x + wPx <= maxX + 1e-6; x += wPx + gap) {
            // verifica piena inclusione (4 angoli)
            const corners: Pt[] = [
                { x, y },
                { x: x + wPx, y },
                { x: x + wPx, y: y + hPx },
                { x, y: y + hPx },
            ];
            if (corners.every(c => pointInPoly(c, clipLocal))) {
                const cx = x + wPx / 2, cy = y + hPx / 2;
                const Cw = localToWorld({ x: cx, y: cy }, O, theta);
                out.push({ cx: Cw.x, cy: Cw.y, wPx, hPx, angleDeg });
            }
        }
    }
    return out;
}
