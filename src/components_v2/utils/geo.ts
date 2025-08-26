// components_v2/utils/geo.ts
export type Pt = { x: number; y: number };

// --- Web Mercator (EPSG:3857) helpers
const EARTH_RADIUS = 6378137; // m
const PI = Math.PI;

export function lonLatTo3857(lon: number, lat: number) {
    const x = (lon * PI / 180) * EARTH_RADIUS;
    const y = Math.log(Math.tan((lat * PI / 180) / 2 + PI / 4)) * EARTH_RADIUS;
    return { x, y };
}

export function merc3857ToLonLat(x: number, y: number) {
    const lon = (x / EARTH_RADIUS) * 180 / PI;
    const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - PI / 2) * 180 / PI;
    return { lon, lat };
}

/** Risoluzione su 3857: metri per pixel a latitudine/zoom */
export function metersPerPixel3857(latDeg: number, zoom: number) {
    const EARTH_CIRC = 40075016.68557849; // m
    const latRad = (latDeg * PI) / 180;
    const resEquator = EARTH_CIRC / 256 / Math.pow(2, zoom);
    return resEquator * Math.cos(latRad);
}

// ---------- NEW: bbox & conversioni → px immagine ----------
export type Bbox3857 = { minX: number; minY: number; maxX: number; maxY: number };

/** Tipo minimo di Snapshot che ci serve qui (evita import circolari) */
export type GeoSnapshot = {
    width?: number;
    height?: number;
    mppImage?: number;
    center?: { lat: number; lon: number };
    zoom?: number;

    // NEW: bounding box del mosaic in metri (EPSG:3857)
    bbox3857?: Bbox3857;
};

/**
 * Converte una coordinata in metri 3857 (X,Y) in px immagine.
 * Preferisce bbox3857; se assente fa fallback a center + mppImage.
 */
export function mercatorToImagePx(
    snap: GeoSnapshot,
    X: number,
    Y: number
): Pt {
    if (snap.width == null || snap.height == null) return { x: 0, y: 0 };

    // 1) via bbox (preciso per i mosaic WMTS)
    if (snap.bbox3857) {
        const { minX, minY, maxX, maxY } = snap.bbox3857;
        const x = ((X - minX) / (maxX - minX)) * snap.width;
        const y = ((maxY - Y) / (maxY - minY)) * snap.height; // Y canvas cresce verso il basso
        return { x, y };
    }

    // 2) fallback: via center + mpp
    if (snap.center && snap.mppImage) {
        const { x: cx, y: cy } = lonLatTo3857(snap.center.lon, snap.center.lat);
        const dx_m = X - cx;
        const dy_m = Y - cy;
        const x = snap.width / 2 + dx_m / snap.mppImage;
        const y = snap.height / 2 - dy_m / snap.mppImage; // inverti asse Y
        return { x, y };
    }

    return { x: 0, y: 0 };
}

/** lon/lat WGS84 → px immagine (usa bbox se disponibile) */
export function lonLatToImagePx(snap: GeoSnapshot, lon: number, lat: number): Pt {
    const { x: X, y: Y } = lonLatTo3857(lon, lat);
    return mercatorToImagePx(snap, X, Y);
}

// ---------- inverse (già presente, lasciato intatto) ----------
/** Converte coordinate immagine (px) → WGS84, usando center/zoom/mpp */
export function imgPxToWGS84(p: Pt, snap: GeoSnapshot) {
    if (
        !snap.width || !snap.height ||
        !snap.center || snap.zoom == null ||
        !snap.mppImage
    ) return null;

    const { x: cx, y: cy } = lonLatTo3857(snap.center.lon, snap.center.lat);

    // delta in metri dal centro immagine
    const dx_m = (p.x - snap.width / 2) * snap.mppImage;
    const dy_m = (p.y - snap.height / 2) * snap.mppImage;

    // Attenzione: asse Y immagine cresce verso il basso → in 3857 l'asse Y cresce verso l'alto
    const X = cx + dx_m;
    const Y = cy - dy_m;

    const { lon, lat } = merc3857ToLonLat(X, Y);
    return { lat, lon };
}


// --- World-Pixel <-> WGS84 (GoogleMapsCompatible 3857) ---
export function lonLatToWorldPx(lon: number, lat: number, zoom: number, tileSize = 256) {
    const scale = tileSize * Math.pow(2, zoom);
    const x = ((lon + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { x, y };
}

export function worldPxToLonLat(px: number, py: number, zoom: number, tileSize = 256) {
    const scale = tileSize * Math.pow(2, zoom);
    const lon = (px / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * py) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lon, lat };
}

export function bboxLonLatFromCenter(center: { lon: number; lat: number }, zoom: number, w: number, h: number) {
    const cpx = lonLatToWorldPx(center.lon, center.lat, zoom);
    const tl = worldPxToLonLat(cpx.x - w / 2, cpx.y - h / 2, zoom); // top-left
    const br = worldPxToLonLat(cpx.x + w / 2, cpx.y + h / 2, zoom); // bottom-right
    return { minLon: tl.lon, minLat: br.lat, maxLon: br.lon, maxLat: tl.lat };
}
