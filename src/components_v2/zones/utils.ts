'use client';

import type { Pt } from '@/types/planner';
import { usePlannerV2Store } from '../state/plannerV2Store';

const EPS = 1e-9;

// ─────────────────────────────────────────────
// helper punto-su-segmento
function pointOnSegment(p: Pt, a: Pt, b: Pt, eps = EPS): boolean {
    const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) > eps) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    if (dot < -eps) return false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (dot - len2 > eps) return false;
    return true;
}

// ray casting inclusivo
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
    let inside = false;
    const n = poly.length;
    if (n < 3) return false;

    // bordo = inside
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[j], b = poly[i];
        if (pointOnSegment(pt, a, b)) return true;
    }

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersects = (yi > pt.y) !== (yj > pt.y);
        if (intersects) {
            const xInt = ((xj - xi) * (pt.y - yi)) / (yj - yi + 0.0) + xi;
            if (xInt >= pt.x - EPS) inside = !inside;
        }
    }
    return inside;
}

export function isInReservedZone(pt: Pt, roofId: string): boolean {
    const zones = usePlannerV2Store.getState().zones;
    const zonesForRoof = zones.filter(z => z.roofId === roofId && z.type === 'riservata');
    for (const z of zonesForRoof) {
        if (pointInPolygon(pt, z.points)) return true;
    }
    return false;
}

// ─────────────────────────────────────────────
// rettangolo ruotato & intersezioni
export type RotRect = { cx: number; cy: number; w: number; h: number; angleDeg: number };

const D2R = Math.PI / 180;

function rectToPoly({ cx, cy, w, h, angleDeg }: RotRect): Pt[] {
    const c = Math.cos(angleDeg * D2R), s = Math.sin(angleDeg * D2R);
    const hx = w / 2, hy = h / 2;
    const local = [
        { x: -hx, y: -hy }, { x: +hx, y: -hy },
        { x: +hx, y: +hy }, { x: -hx, y: +hy },
    ];
    return local.map(p => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
}

function polyAABB(poly: Pt[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function aabbOverlap(a: ReturnType<typeof polyAABB>, b: ReturnType<typeof polyAABB>, eps = 0) {
    return !(
        a.maxX < b.minX - eps ||
        a.minX > b.maxX + eps ||
        a.maxY < b.minY - eps ||
        a.minY > b.maxY + eps
    );
}

function segsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt) {
    const d = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = d(a1, a2, b1), o2 = d(a1, a2, b2), o3 = d(b1, b2, a1), o4 = d(b1, b2, a2);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
    // collinear touching
    return (
        pointOnSegment(b1, a1, a2) ||
        pointOnSegment(b2, a1, a2) ||
        pointOnSegment(a1, b1, b2) ||
        pointOnSegment(a2, b1, b2)
    );
}

function polyIntersectsPoly(A: Pt[], B: Pt[]): boolean {
    if (A.some(p => pointInPolygon(p, B))) return true;
    if (B.some(p => pointInPolygon(p, A))) return true;
    for (let i = 0; i < A.length; i++) {
        const a1 = A[i], a2 = A[(i + 1) % A.length];
        for (let j = 0; j < B.length; j++) {
            const b1 = B[j], b2 = B[(j + 1) % B.length];
            if (segsIntersect(a1, a2, b1, b2)) return true;
        }
    }
    return false;
}

/** TRUE se il rettangolo ruotato tocca/interseca una qualsiasi zona riservata della falda. */
export function overlapsReservedRect(
    rect: RotRect,
    roofId: string,
    epsilonPx: number = 1
): boolean {
    const zones = usePlannerV2Store.getState().zones;
    const zonesForRoof = zones.filter(z => z.roofId === roofId && z.type === 'riservata');
    if (!zonesForRoof.length) return false;

    const rr: RotRect = { ...rect, w: rect.w + epsilonPx * 2, h: rect.h + epsilonPx * 2 };
    const R = rectToPoly(rr);
    const aabbR = polyAABB(R);

    for (const z of zonesForRoof) {
        const aabbZ = polyAABB(z.points);
        if (!aabbOverlap(aabbR, aabbZ, 0)) continue;
        if (polyIntersectsPoly(R, z.points)) return true;
    }
    return false;
}

/**
 * come sopra ma con le barre neve.
 * Accetta sia {w,h} che {wPx,hPx} (così va con TopToolbar).
 */
export function overlapsSnowGuard(
    rect: { cx: number; cy: number; w?: number; h?: number; wPx?: number; hPx?: number; angleDeg: number },
    roofId: string,
    padPx = 6
): boolean {
    const { snowGuards } = usePlannerV2Store.getState();
    const guards = snowGuards.filter(g => g.roofId === roofId);

    console.log('[snowguard-check]', {
        roofId,
        guards: guards.map(g => ({ id: g.id, p1: g.p1, p2: g.p2 })),
        rect,
        padPx,
    });

    if (!guards.length) return false;

    // normalizza w/h
    const w = (rect.w ?? rect.wPx ?? 0) + padPx * 2;
    const h = (rect.h ?? rect.hPx ?? 0) + padPx * 2;

    const poly = rectToPoly({
        cx: rect.cx,
        cy: rect.cy,
        w,
        h,
        angleDeg: rect.angleDeg,
    });

    // lati del pannello
    const edges: [Pt, Pt][] = [
        [poly[0], poly[1]],
        [poly[1], poly[2]],
        [poly[2], poly[3]],
        [poly[3], poly[0]],
    ];

    for (const sg of guards) {
        // 1) un estremo dentro al pannello → collisione
        if (pointInPolygon(sg.p1, poly) || pointInPolygon(sg.p2, poly)) {
            return true;
        }
        // 2) la linea taglia uno dei lati del pannello → collisione
        for (const [a, b] of edges) {
            if (segsIntersect(a, b, sg.p1, sg.p2)) {
                return true;
            }
        }
    }

    return false;
}

/** Utility se ti serve filtrare liste di moduli (w/h/angolo in px). */
export function filterRectsOutsideZonesByGeometry(
    rects: { cx: number; cy: number; w: number; h: number; angleDeg: number }[],
    roofId: string,
    epsilonPx = 1
) {
    return rects.filter(r => !overlapsReservedRect({ cx: r.cx, cy: r.cy, w: r.w, h: r.h, angleDeg: r.angleDeg }, roofId, epsilonPx));
}

/** versione centro-based vecchia (se mai ti serve) */
// export function filterRectsOutsideZones(rects: RectWorld[], roofId: string): RectWorld[] { ... }

export type RectWorld = { cx: number; cy: number; w: number; h: number };

export function filterRectsOutsideZones(rects: RectWorld[], roofId: string): RectWorld[] {
    return rects.filter(r => !isInReservedZone({ x: r.cx, y: r.cy }, roofId));
}
