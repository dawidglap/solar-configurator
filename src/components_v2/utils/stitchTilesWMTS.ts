// utils/stitchTilesWMTS.ts
export type TiledSnapshotParams = {
    lat: number;
    lon: number;
    zoom: number;          // z WebMercator
    width: number;         // px del canvas finale
    height: number;        // px del canvas finale
    scale: 1 | 2;          // densità pixel
    tileUrl: (z: number, x: number, y: number) => string; // template URL
    attribution?: string;  // watermark
};

const TILE = 256;

function lon2x(lon: number, z: number) {
    return ((lon + 180) / 360) * Math.pow(2, z);
}
function lat2y(lat: number, z: number) {
    const rad = (lat * Math.PI) / 180;
    return (
        (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 *
        Math.pow(2, z)
    );
}

export async function buildTiledSnapshot(p: TiledSnapshotParams) {
    const { lat, lon, zoom, width, height, scale, tileUrl, attribution } = p;
    const W = width * scale;
    const H = height * scale;

    const cx = lon2x(lon, zoom);
    const cy = lat2y(lat, zoom);

    const pxCenterX = cx * TILE;
    const pxCenterY = cy * TILE;

    const pxMinX = Math.floor(pxCenterX - W / 2);
    const pxMinY = Math.floor(pxCenterY - H / 2);
    const pxMaxX = pxMinX + W;
    const pxMaxY = pxMinY + H;

    const tileMinX = Math.floor(pxMinX / TILE);
    const tileMinY = Math.floor(pxMinY / TILE);
    const tileMaxX = Math.floor((pxMaxX - 1) / TILE);
    const tileMaxY = Math.floor((pxMaxY - 1) / TILE);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const n = Math.pow(2, zoom);

    const promises: Promise<void>[] = [];
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
        for (let tx = tileMinX; tx <= tileMaxX; tx++) {
            const xWrapped = ((tx % n) + n) % n; // wrap X
            const yClamped = Math.min(Math.max(ty, 0), n - 1); // clamp Y

            const img = new Image();
            img.crossOrigin = 'anonymous';
            const url = tileUrl(zoom, xWrapped, yClamped);

            promises.push(
                new Promise<void>((resolve) => {
                    img.onload = () => {
                        const dstX = tx * TILE - pxMinX;
                        const dstY = ty * TILE - pxMinY;
                        ctx.drawImage(img, dstX, dstY);
                        resolve();
                    };
                    img.onerror = () => resolve(); // buchi: ignora per robustezza
                    img.src = url;
                })
            );
        }
    }

    await Promise.all(promises);

    // watermark obbligatorio
    if (attribution) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.font = `${12 * scale}px sans-serif`;
        ctx.fillText(attribution, 10 * scale, (H - 10) * scale);
    }

    return { dataUrl: canvas.toDataURL('image/png'), width: W, height: H };
}

/* Helpers per fonti note */
export const TILE_OSM = (z: number, x: number, y: number) =>
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

// Orthofoto ad alta risoluzione
export const TILE_SWISSTOPO_SAT = (z: number, x: number, y: number) =>
    `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`;
