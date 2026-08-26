// components_v2/zones/utils.ts
'use client';

import { usePlannerV2Store } from '../state/plannerV2Store';
import {
    legacyPointInPolygon,
    legacyRectIntersectsPolygon,
    legacyRectIntersectsSegment,
} from '@/lib/planning-core/legacy-standard/collision';
import type { LegacyPoint as Pt } from '@/lib/planning-core/legacy-standard/types';

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

    return list.some((z) => legacyPointInPolygon(p, z.points || []));
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

    return relevant.some((z) => {
        const poly: Pt[] = z.points || [];
        if (!poly || poly.length < 3) return false;
        return legacyRectIntersectsPolygon(
            { cx: rect.cx, cy: rect.cy, wPx: rect.w, hPx: rect.h, angleDeg: rect.angleDeg },
            poly
        );
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

    return relevant.some((guard) =>
        legacyRectIntersectsSegment(rect, guard.p1, guard.p2)
    );
}
