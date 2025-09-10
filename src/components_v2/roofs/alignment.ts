// components_v2/roofs/alignment.ts
export type Pt = { x: number; y: number };

export function rotateAround(p: Pt, c: Pt, deg: number): Pt {
    const th = (deg * Math.PI) / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function rotatePolygon(pts: Pt[], pivot: Pt, deg: number): Pt[] {
    if (!deg) return pts;
    return pts.map(pt => rotateAround(pt, pivot, deg));
}
