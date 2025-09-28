// src/components_v2/canvas/utils/snap.ts
export type Pt = { x: number; y: number };

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len2 = (p: Pt) => p.x * p.x + p.y * p.y;
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

// ──────────────────────────────────────────────────────────────
// Parametri "discreti" (stile Canva)
// - MAX_LATERAL_PX: corridoio laterale di snap (più piccolo = meno aggressivo)
// - MIN_MOVE_PX: ignora micro-movimenti
const MAX_LATERAL_PX = 20;
const MIN_MOVE_PX = 2;
// ──────────────────────────────────────────────────────────────

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
    if (Math.hypot(v.x, v.y) < MIN_MOVE_PX) {
        return { pt: pointer, snapped: false, kind: null };
    }

    if (!refDir || (!refDir.x && !refDir.y)) {
        return { pt: pointer, snapped: false, kind: null };
    }

    const refN = norm(refDir);
    const vN = norm(v);
    const perpN = { x: -refN.y, y: refN.x };

    // angolo del mouse rispetto a ref
    const deg = angleBetween(vN, refN);

    // proiezioni CON SEGNO
    const tRef = v.x * refN.x + v.y * refN.y;   // componente lungo ref
    const tPerp = v.x * perpN.x + v.y * perpN.y;  // componente lungo perp

    // distanze laterali (quanto sei lontano dall’asse)
    const latRef = Math.abs(v.x * perpN.x + v.y * perpN.y); // distanza dall'asse ref
    const latPerp = Math.abs(v.x * refN.x + v.y * refN.y); // distanza dall'asse perp

    const canSnapParallel = (deg <= tolDeg || Math.abs(deg - 180) <= tolDeg) && latRef <= MAX_LATERAL_PX;
    const canSnapPerp = Math.abs(deg - 90) <= tolDeg && latPerp <= MAX_LATERAL_PX;

    if (!canSnapParallel && !canSnapPerp) {
        return { pt: pointer, snapped: false, kind: null };
    }

    // scegli il candidato con distanza laterale minore (più "vicino" all'asse)
    let kind: 'parallel' | 'perpendicular';
    if (canSnapParallel && canSnapPerp) {
        kind = latRef <= latPerp ? 'parallel' : 'perpendicular';
    } else {
        kind = canSnapParallel ? 'parallel' : 'perpendicular';
    }

    const dir = kind === 'parallel' ? refN : perpN;
    const t = kind === 'parallel' ? tRef : tPerp; // ← mantiene il SEGNO (su/giù, dx/sx)

    const pt = add(origin, mul(dir, t));

    const L = 10000;
    const guide = { a: add(origin, mul(dir, -L)), b: add(origin, mul(dir, L)) };

    return { pt, snapped: true, kind, guide };
}

export function isNear(a: Pt, b: Pt, radius = 12): boolean {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy <= radius * radius;
}
