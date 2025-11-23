// components_v2/zones/utils.ts
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };

type RectForReserved = {
    cx: number;
    cy: number;
    w: number;
    h: number;
    angleDeg: number;
};

type RectForSnow = {
    cx: number;
    cy: number;
    wPx: number;
    hPx: number;
    angleDeg: number;
};

// ---------- helper geometrici ----------

function deg2rad(d: number) {
    return (d * Math.PI) / 180;
}

function rectToPoly(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angleDeg: number
): Pt[] {
    const hw = w / 2;
    const hh = h / 2;
    const theta = deg2rad(angleDeg);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    const local: Pt[] = [
        { x: -hw, y: -hh },
        { x: +hw, y: -hh },
        { x: +hw, y: +hh },
        { x: -hw, y: +hh },
    ];

    return local.map((p) => ({
        x: cx + p.x * c - p.y * s,
        y: cy + p.x * s + p.y * c,
    }));
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x,
            yi = poly[i].y;
        const xj = poly[j].x,
            yj = poly[j].y;

        const intersect =
            yi > p.y !== yj > p.y &&
            p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi;

        if (intersect) inside = !inside;
    }
    return inside;
}

function segmentsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
    const cross = (p: Pt, q: Pt, r: Pt) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

    const c1 = cross(a1, a2, b1);
    const c2 = cross(a1, a2, b2);
    const c3 = cross(b1, b2, a1);
    const c4 = cross(b1, b2, a2);

    if ((c1 === 0 && onSegment(a1, a2, b1)) ||
        (c2 === 0 && onSegment(a1, a2, b2)) ||
        (c3 === 0 && onSegment(b1, b2, a1)) ||
        (c4 === 0 && onSegment(b1, b2, a2))) {
        return true;
    }

    return c1 * c2 < 0 && c3 * c4 < 0;
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
    return (
        Math.min(a.x, b.x) - 1e-6 <= p.x &&
        p.x <= Math.max(a.x, b.x) + 1e-6 &&
        Math.min(a.y, b.y) - 1e-6 <= p.y &&
        p.y <= Math.max(a.y, b.y) + 1e-6
    );
}

function polysIntersect(a: Pt[], b: Pt[]): boolean {
    // 1) vertici dentro l'altro
    if (a.some((p) => pointInPoly(p, b))) return true;
    if (b.some((p) => pointInPoly(p, a))) return true;

    // 2) intersezione segmenti
    for (let i = 0; i < a.length; i++) {
        const a1 = a[i];
        const a2 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            const b1 = b[j];
            const b2 = b[(j + 1) % b.length];
            if (segmentsIntersect(a1, a2, b1, b2)) return true;
        }
    }
    return false;
}

// ---------- ZONE RISERVATE ----------

/**
 * Ritorna true se il punto è dentro una qualsiasi zona riservata
 * (hindernis) della falda (se roofId è specificato).
 */
export function isInReservedZone(p: Pt, roofId?: string): boolean {
    const st: any = usePlannerV2Store.getState();
    const zones: any[] = Array.isArray(st.zones) ? st.zones : [];

    const list = zones.filter((z) => {
        if (roofId && z.roofId !== roofId) return false;
        // accetta i vari tipi possibili che hai usato
        const t = String(z.type || '').toLowerCase();
        return t === 'riservata' || t === 'hindernis' || t === 'reserved';
    });

    return list.some((z) => pointInPoly(p, z.points || []));
}

/**
 * Controlla se il rettangolo modulo (cx,cy,w,h,angleDeg) interseca
 * una qualche zona riservata della falda `roofId`.
 */
export function overlapsReservedRect(
    rect: RectForReserved,
    roofId: string,
    _epsPx = 1
): boolean {
    const st: any = usePlannerV2Store.getState();
    const zones: any[] = Array.isArray(st.zones) ? st.zones : [];

    const relevant = zones.filter((z) => {
        if (z.roofId !== roofId) return false;
        const t = String(z.type || '').toLowerCase();
        return t === 'riservata' || t === 'hindernis' || t === 'reserved';
    });

    if (!relevant.length) return false;

    const rectPoly = rectToPoly(rect.cx, rect.cy, rect.w, rect.h, rect.angleDeg);

    return relevant.some((z) => {
        const poly: Pt[] = z.points || [];
        if (!poly || poly.length < 3) return false;
        return polysIntersect(rectPoly, poly);
    });
}

// ---------- SCHNEEFANG / SNOW GUARD ----------

/**
 * Controlla se il rettangolo modulo interseca una qualsiasi linea neve
 * (snow guard) sulla falda `roofId`.
 */
export function overlapsSnowGuard(
    rect: RectForSnow,
    roofId: string,
    _thicknessPx = 1
): boolean {
    const st: any = usePlannerV2Store.getState();
    const guards: any[] = Array.isArray(st.snowGuards) ? st.snowGuards : [];

    const relevant = guards.filter((g) => g.roofId === roofId);
    if (!relevant.length) return false;

    const rectPoly = rectToPoly(
        rect.cx,
        rect.cy,
        rect.wPx,
        rect.hPx,
        rect.angleDeg
    );

    // 1) se un estremo della linea cade dentro il modulo
    for (const sg of relevant) {
        const p1: Pt = sg.p1;
        const p2: Pt = sg.p2;
        if (pointInPoly(p1, rectPoly) || pointInPoly(p2, rectPoly)) {
            return true;
        }

        // 2) se un lato del modulo interseca la linea neve
        for (let i = 0; i < rectPoly.length; i++) {
            const a = rectPoly[i];
            const b = rectPoly[(i + 1) % rectPoly.length];
            if (segmentsIntersect(a, b, p1, p2)) return true;
        }
    }

    return false;
}
