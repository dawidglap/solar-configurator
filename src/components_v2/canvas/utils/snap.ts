// src/components_v2/canvas/utils/snap.ts
export type Pt = { x: number; y: number };

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const norm = (p: Pt): Pt => {
    const d = Math.hypot(p.x, p.y) || 1;
    return { x: p.x / d, y: p.y / d };
};
const angleBetween = (u: Pt, v: Pt) => {
    const ang = Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x);
    let deg = Math.abs((ang * 180) / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return deg;
};

export function snapParallelPerp(
    origin: Pt,
    pointer: Pt,
    refDir?: Pt,
    tolDeg = 12
): {
    pt: Pt;
    snapped: boolean;
    kind: null | 'parallel' | 'perpendicular';
    guide?: { a: Pt; b: Pt };
} {
    const v = sub(pointer, origin);
    const len = Math.hypot(v.x, v.y);
    if (len === 0) return { pt: pointer, snapped: false, kind: null };

    const ref = refDir && (refDir.x || refDir.y) ? refDir : { x: 1, y: 0 };
    const refN = norm(ref);
    const vN = norm(v);

    const deg = angleBetween(vN, refN);

    let snapped = false;
    let kind: null | 'parallel' | 'perpendicular' = null;
    let dir = vN;

    if (deg <= tolDeg || Math.abs(deg - 180) <= tolDeg) {
        dir = refN;
        snapped = true;
        kind = 'parallel';
    } else if (Math.abs(deg - 90) <= tolDeg) {
        dir = { x: -refN.y, y: refN.x };
        snapped = true;
        kind = 'perpendicular';
    }

    if (!snapped) return { pt: pointer, snapped, kind };

    const pt = add(origin, mul(dir, len));
    const guide = { a: add(origin, mul(dir, -10000)), b: add(origin, mul(dir, 10000)) };
    return { pt, snapped, kind, guide };
}

export function isNear(a: Pt, b: Pt, radius = 12): boolean {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy <= radius * radius;
}
