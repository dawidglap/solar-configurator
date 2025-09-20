// components_v2/services/sonnendach.ts
'use client';

import type { Pt } from '@/components_v2/utils/geo';
import {
    merc3857ToLonLat,
    lonLatToImagePx,
    lonLatTo3857,
    type GeoSnapshot,
} from '@/components_v2/utils/geo';

// ─────────────────────────────────────────────────────────────
// TIPI
// ─────────────────────────────────────────────────────────────
export type SonnRoofPoly = {
    id: string;
    pointsPx: Pt[];           // coordinate in PX IMMAGINE, pronte da disegnare
    tiltDeg?: number;         // "neigung" (0 = pianeggiante)
    azimuthDeg?: number;      // "ausrichtung" (0=N, 90=E...)
    eignung?: string;         // idoneità (opzionale, utile in futuro)
    raw?: any;                // record completo
};

// ─────────────────────────────────────────────────────────────
// MANOPOLE DI SENSIBILITÀ (MODIFICA QUI)
// Aumenta per avere MENO falde; diminuisci per PIÙ dettagli.
// ─────────────────────────────────────────────────────────────
export const ROOF_FILTERS = {
    MIN_AREA_M2: 0.5,        // accetta anche falde molto piccole (prima 2.5)
    SIMPLIFY_EPS_M: 0.15,    // meno semplificazione, mantiene più dettagli
    MIN_COMPACTNESS: 0.02,   // permette poligoni irregolari (prima 0.10)
    CLUSTER_DIST_M: 2.5,     // raggruppa falde vicine (prima 1.8)
    MERGE_ANGLE_DEG: 35,     // unisce anche falde con angoli più diversi (prima 22)
    MERGE_STRATEGY: 'largest' // evita che “hull” fonda tutto in un unico blob
};


// Abilita per log diagnostici dei conteggi
const DEBUG_COUNTS = false;

// ─────────────────────────────────────────────────────────────
// HELPERS GEO / FILTRI
// ─────────────────────────────────────────────────────────────
function polygonAreaPx2(pts: Pt[]): number {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a / 2);
}
function toM2(areaPx2: number, mpp?: number) {
    return mpp ? areaPx2 * mpp * mpp : 0;
}
function perimeterPx(pts: Pt[]): number {
    let p = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        p += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return p;
}
// (4πA)/P² ∈ (0..1]; più vicino a 0 = più filamentoso
function compactness(pts: Pt[], mpp?: number) {
    const A = toM2(polygonAreaPx2(pts), mpp);
    const Pm = perimeterPx(pts) * (mpp ?? 0);
    if (!A || !Pm) return 0;
    return (4 * Math.PI * A) / (Pm * Pm);
}

// Douglas–Peucker su px
function simplifyDP(pts: Pt[], epsPx: number): Pt[] {
    if (pts.length < 3 || epsPx <= 0) return pts;
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;

    const stack: [number, number][] = [[0, pts.length - 1]];
    const dist = (p: Pt, a: Pt, b: Pt) => {
        const A = { x: p.x - a.x, y: p.y - a.y };
        const B = { x: b.x - a.x, y: b.y - a.y };
        const len2 = B.x * B.x + B.y * B.y || 1e-9;
        const t = Math.max(0, Math.min(1, (A.x * B.x + A.y * B.y) / len2));
        const proj = { x: a.x + t * B.x, y: a.y + t * B.y };
        return Math.hypot(p.x - proj.x, p.y - proj.y);
    };

    while (stack.length) {
        const [i, j] = stack.pop()!;
        let idx = -1, maxd = 0;
        for (let k = i + 1; k < j; k++) {
            const d = dist(pts[k], pts[i], pts[j]);
            if (d > maxd) { maxd = d; idx = k; }
        }
        if (maxd > epsPx && idx !== -1) {
            keep[idx] = true;
            stack.push([i, idx], [idx, j]);
        }
    }
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
}

// Centroidi e distanze
function centroidPx(pts: Pt[]): Pt {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    const n = pts.length || 1;
    return { x: x / n, y: y / n };
}
function degDiff(a?: number, b?: number) {
    if (typeof a !== 'number' || typeof b !== 'number') return 0; // se assente, non bloccare
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
}
function distPx(a: Pt, b: Pt) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// Convex hull (Monotone Chain)
function convexHull(points: Pt[]): Pt[] {
    if (points.length <= 3) return points.slice();
    const pts = points.slice().sort((A, B) => A.x - B.x || A.y - B.y);
    const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Pt[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Pt[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}



// Clustering per vicinanza+angolo (greedy simile a DBSCAN)
function clusterRoofPolys(
    polys: SonnRoofPoly[],
    mpp?: number,
    distM = 0.8,
    angleDeg = 12
): SonnRoofPoly[][] {
    if (!mpp || polys.length === 0) return polys.map(p => [p]);
    const distPxThr = distM / mpp;

    const cents = polys.map(p => centroidPx(p.pointsPx));
    const used = new Array(polys.length).fill(false);
    const groups: SonnRoofPoly[][] = [];

    for (let i = 0; i < polys.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const group = [polys[i]];
        const queue = [i];

        while (queue.length) {
            const u = queue.pop()!;
            for (let v = 0; v < polys.length; v++) {
                if (used[v]) continue;
                if (distPx(cents[u], cents[v]) > distPxThr) continue;      // distanza centroidi
                if (degDiff(polys[u].azimuthDeg, polys[v].azimuthDeg) > angleDeg) continue; // vincolo angolare
                used[v] = true;
                group.push(polys[v]);
                queue.push(v);
            }
        }
        groups.push(group);
    }
    return groups;
}

// Merge di un gruppo: convex hull o tieni la più grande
function mergeGroup(
    polys: SonnRoofPoly[],
    strategy: 'hull' | 'largest' = 'hull'
): SonnRoofPoly {
    if (polys.length === 1) return polys[0];

    if (strategy === 'largest') {
        let best = polys[0], bestA = polygonAreaPx2(polys[0].pointsPx);
        for (let i = 1; i < polys.length; i++) {
            const a = polygonAreaPx2(polys[i].pointsPx);
            if (a > bestA) { best = polys[i]; bestA = a; }
        }
        return best;
    }

    // 'hull' → unisci tutti i punti e fai un convex hull
    const pts: Pt[] = [];
    for (const p of polys) pts.push(...p.pointsPx);
    const hull = convexHull(pts);

    // azimut/tilt medi (grezzi) pesati per area px²
    let sumA = 0, sumTilt = 0, sumAz = 0, cntTilt = 0, cntAz = 0;
    for (const p of polys) {
        const a = polygonAreaPx2(p.pointsPx);
        sumA += a;
        if (typeof p.tiltDeg === 'number') { sumTilt += p.tiltDeg * a; cntTilt++; }
        if (typeof p.azimuthDeg === 'number') { sumAz += p.azimuthDeg * a; cntAz++; }
    }

    return {
        id: polys.map(p => p.id).join('+'),
        pointsPx: hull,
        tiltDeg: cntTilt ? (sumTilt / sumA) : undefined,
        azimuthDeg: cntAz ? (sumAz / sumA) : undefined,
        eignung: polys[0].eignung,
        raw: { merged: polys.map(p => p.raw) }
    };
}

/** Calcola extent in WGS84 [minLon,minLat,maxLon,maxLat] partendo dallo snapshot */
function extent4326FromSnapshot(snap: GeoSnapshot): [number, number, number, number] {
    // 1) se abbiamo bbox3857 (preciso, consigliato con il mosaico WMTS)
    if (snap.bbox3857) {
        const { minX, minY, maxX, maxY } = snap.bbox3857;
        const sw = merc3857ToLonLat(minX, minY);
        const ne = merc3857ToLonLat(maxX, maxY);
        return [sw.lon, sw.lat, ne.lon, ne.lat];
    }

    // 2) fallback: center + mpp * dimensioni
    if (snap.center && snap.width && snap.height && snap.mppImage) {
        const hw_m = (snap.width * snap.mppImage) / 2;
        const hh_m = (snap.height * snap.mppImage) / 2;
        const c = lonLatTo3857(snap.center.lon, snap.center.lat);
        const sw = merc3857ToLonLat(c.x - hw_m, c.y - hh_m);
        const ne = merc3857ToLonLat(c.x + hw_m, c.y + hh_m);
        return [sw.lon, sw.lat, ne.lon, ne.lat];
    }

    // 3) ultima spiaggia: rettangolino intorno al centro
    const lon = snap.center?.lon ?? 8.55;
    const lat = snap.center?.lat ?? 47.37;
    const d = 0.002; // ~200 m
    return [lon - d, lat - d, lon + d, lat + d];
}

// ─────────────────────────────────────────────────────────────
// FETCH + POST-FETCH (semplifica → filtra → cluster → merge)
// Puoi passare override dei filtri nel terzo argomento.
// ─────────────────────────────────────────────────────────────
export async function fetchRoofPolysForSnapshot(
    snap: GeoSnapshot,
    lang: 'de' | 'it' | 'fr' | 'en' = 'de',
    filters: Partial<typeof ROOF_FILTERS> = {}
): Promise<SonnRoofPoly[]> {
    if (!snap.width || !snap.height) return [];



    // merge dei filtri (override > default)
    const F = { ...ROOF_FILTERS, ...filters };

    const [minLon, minLat, maxLon, maxLat] = extent4326FromSnapshot(snap);

    const base = 'https://api3.geo.admin.ch/rest/services/energie/MapServer/identify';
    const params: Record<string, string | number> = {
        geometryType: 'esriGeometryEnvelope',
        geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
        sr: 4326,
        layers: 'all:ch.bfe.solarenergie-eignung-daecher',
        tolerance: 0,
        mapExtent: `${minLon},${minLat},${maxLon},${maxLat}`,
        imageDisplay: `${snap.width},${snap.height},96`,
        lang,
    };
    const url = `${base}?${new URLSearchParams(params as any).toString()}`;

    const resp = await fetch(url);
    if (!resp.ok) return [];

    const data = await resp.json();
    const results: any[] = data?.results ?? [];
    if (!Array.isArray(results) || results.length === 0) return [];

    // 1) POLIGONI GREZZI
    const rawPolys: SonnRoofPoly[] = [];
    for (const res of results) {
        const rings: number[][][] | undefined = res?.geometry?.rings;
        if (!rings) continue;

        // NB: i ring sono in [x=lon, y=lat]
        for (const ring of rings) {
            const pointsPx: Pt[] = ring.map(([lon, lat]) => lonLatToImagePx(snap, lon, lat));
            const attrs = res?.attributes ?? {};
            const id = String(attrs.id ?? attrs.objectid ?? `${Date.now()}_${rawPolys.length}`);

            rawPolys.push({
                id,
                pointsPx,
                tiltDeg: typeof attrs.neigung === 'number' ? attrs.neigung : undefined,
                azimuthDeg: typeof attrs.ausrichtung === 'number' ? attrs.ausrichtung : undefined,
                eignung: attrs.dach_eignung ?? attrs.eignung ?? undefined,
                raw: res,
            });
        }
    }

    // 2) SEMPLIFICAZIONE (m → px)
    const epsPx = snap.mppImage ? F.SIMPLIFY_EPS_M / snap.mppImage : 0;
    const simplified = epsPx > 0
        ? rawPolys.map(r => ({ ...r, pointsPx: simplifyDP(r.pointsPx, epsPx) }))
        : rawPolys;

    // 3) FILTRO AREA MINIMA (m²)
    const afterArea = simplified.filter(r => {
        const aM2 = toM2(polygonAreaPx2(r.pointsPx), snap.mppImage);
        return aM2 >= F.MIN_AREA_M2;
    });

    // 4) FILTRO SLIVER (compattezza)
    const afterCompact = afterArea.filter(r => compactness(r.pointsPx, snap.mppImage) >= F.MIN_COMPACTNESS);

    // 5) CLUSTER (vicinanza + quasi co-orientate)
    const groups = clusterRoofPolys(afterCompact, snap.mppImage, F.CLUSTER_DIST_M, F.MERGE_ANGLE_DEG);

    // 6) MERGE (convex hull o tieni la più grande)
    const merged = groups.map(g => mergeGroup(g, F.MERGE_STRATEGY as 'hull' | 'largest'));


    if (DEBUG_COUNTS) {
        console.log('sonnendach count:', {
            raw: rawPolys.length,
            simplified: simplified.length,
            afterArea: afterArea.length,
            afterCompact: afterCompact.length,
            groups: groups.length,
            merged: merged.length,
        });
    }

    return merged;
}
