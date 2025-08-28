// src/components_v2/canvas/geom.ts
'use client';

export type Pt = { x: number; y: number };

// area di un poligono in px^2
export function polygonAreaPx2(pts: Pt[]) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a / 2);
}

// distanza euclidea
export function dist(a: Pt, b: Pt) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

// Rettangolo dai 3 punti + azimut coerente con la gronda
export function rectFrom3WithAz(
    A: Pt, B: Pt, C: Pt
): { poly: Pt[]; azimuthDeg: number } {
    const vx = B.x - A.x, vy = B.y - A.y;
    const len = Math.hypot(vx, vy) || 1;

    // normale unitaria alla base A→B
    const nx = -vy / len, ny = vx / len;

    // proiezione (C - B) sulla normale → altezza signed
    const hx = C.x - B.x, hy = C.y - B.y;
    const h = hx * nx + hy * ny;

    // offset verso il lato opposto del rettangolo
    const off = { x: nx * h, y: ny * h };
    const D = { x: A.x + off.x, y: A.y + off.y };
    const C2 = { x: B.x + off.x, y: B.y + off.y };

    // direzione verso gronda = opposta alla direzione di costruzione
    const sign = Math.sign(h) || 1;
    const dirToEaves = { x: -sign * nx, y: -sign * ny };

    // vettore immagine → azimut (0=N, 90=E) con y-down
    const az = (Math.atan2(dirToEaves.x, -dirToEaves.y) * 180) / Math.PI;
    const azimuthDeg = ((az % 360) + 360) % 360;

    return { poly: [A, B, C2, D], azimuthDeg };
}
