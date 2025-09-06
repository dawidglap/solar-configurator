'use client';

import type { Pt } from '@/types/planner';
import { usePlannerV2Store } from '../state/plannerV2Store';

const EPS = 1e-9;

// punto P sul segmento AB (con tolleranza)
function pointOnSegment(p: Pt, a: Pt, b: Pt, eps = EPS): boolean {
    const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) > eps) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    if (dot < -eps) return false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (dot - len2 > eps) return false;
    return true;
}

// Ray casting inclusivo: true anche se pt sta su un lato/vertice
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
    let inside = false;
    const n = poly.length;
    if (n < 3) return false;

    // 1) bordo/vertice = inside
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[j], b = poly[i];
        if (pointOnSegment(pt, a, b)) return true;
    }

    // 2) odd-even ray casting
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

/* ──────────────────────────────
   Helpers per “trasforma in moduli”
   ────────────────────────────── */

export type RectWorld = { cx: number; cy: number; w: number; h: number };

/** Rimuove i moduli il cui centro cade in una zona riservata della falda. */
export function filterRectsOutsideZones(rects: RectWorld[], roofId: string): RectWorld[] {
    return rects.filter(r => !isInReservedZone({ x: r.cx, y: r.cy }, roofId));
}
