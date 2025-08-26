// components_v2/services/sonnendach.ts
'use client';

import type { Pt } from '@/components_v2/utils/geo';
import {
    merc3857ToLonLat,
    lonLatToImagePx,
    lonLatTo3857,
    metersPerPixel3857,
    type GeoSnapshot,
} from '@/components_v2/utils/geo';

export type SonnRoofPoly = {
    id: string;
    pointsPx: Pt[];           // coordinate in PX IMMAGINE, pronte da disegnare
    tiltDeg?: number;         // "neigung" (0 = pianeggiante)
    azimuthDeg?: number;      // "ausrichtung" (0=N, 90=E...)
    eignung?: string;         // idoneità (opzionale, utile in futuro)
    raw?: any;                // record completo, se ti serve
};

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

/**
 * Chiama l'endpoint di Sonnendach (geo.admin.ch) per le FALDE dentro lo snapshot.
 * Ritorna i poligoni in PX immagine + attributi (tilt/azimut).
 */
export async function fetchRoofPolysForSnapshot(
    snap: GeoSnapshot,
    lang: 'de' | 'it' | 'fr' | 'en' = 'de'
): Promise<SonnRoofPoly[]> {
    if (!snap.width || !snap.height) return [];

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

    const out: SonnRoofPoly[] = [];

    for (const res of results) {
        const rings: number[][][] | undefined = res?.geometry?.rings;
        if (!rings) continue;

        // NB: i ring sono in [x=lon, y=lat]
        for (const ring of rings) {
            const pointsPx: Pt[] = ring.map(([lon, lat]) => lonLatToImagePx(snap, lon, lat));

            const attrs = res?.attributes ?? {};
            const id = String(attrs.id ?? attrs.objectid ?? `${Date.now()}_${out.length}`);

            out.push({
                id,
                pointsPx,
                tiltDeg: typeof attrs.neigung === 'number' ? attrs.neigung : undefined,
                azimuthDeg: typeof attrs.ausrichtung === 'number' ? attrs.ausrichtung : undefined,
                eignung: attrs.dach_eignung ?? attrs.eignung ?? undefined,
                raw: res,
            });
        }
    }

    return out;
}
