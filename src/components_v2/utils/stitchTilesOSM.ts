// src/components_v2/utils/stitchTilesOSM.ts
export type OSMStitchArgs = {
    lat: number;
    lon: number;
    zoom: number;            // 14..22
    width: number;           // canvas px (visibili)
    height: number;
    scale?: 1 | 2;           // retina (facoltativo)
    drawAttribution?: boolean;
};

function lonLatToWorldPx(lon: number, lat: number, z: number) {
    const n = Math.pow(2, z);
    const world = 256 * n;
    const x = ((lon + 180) / 360) * world;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y =
        (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world;
    return { x, y, world };
}

function wrapX(x: number, n: number) {
    // wrap orizzontale (anti-artefatti vicino al meridiano 180°)
    return ((x % n) + n) % n;
}

function loadImg(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Tile load error: " + url));
        img.src = url;
    });
}

/**
 * Costruisce uno snapshot OSM disegnando i tile su un canvas.
 * Ritorna un dataURL PNG e le dimensioni finali.
 */
export async function buildOSMSnapshot({
    lat,
    lon,
    zoom,
    width,
    height,
    scale = 1,
    drawAttribution = true,
}: OSMStitchArgs): Promise<{ dataUrl: string; width: number; height: number }> {
    const n = Math.pow(2, zoom);
    const TILE = 256;

    const canvasW = Math.max(1, Math.round(width * scale));
    const canvasH = Math.max(1, Math.round(height * scale));

    const { x, y, world } = lonLatToWorldPx(lon, lat, zoom);

    // top-left in world px, centrato sul target
    const x0 = Math.round(x - canvasW / 2);
    const y0 = Math.round(y - canvasH / 2);

    const xStart = Math.floor(x0 / TILE);
    const yStart = Math.floor(y0 / TILE);
    const xEnd = Math.floor((x0 + canvasW - 1) / TILE);
    const yEnd = Math.floor((y0 + canvasH - 1) / TILE);

    const c = document.createElement("canvas");
    c.width = canvasW;
    c.height = canvasH;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context missing.");

    const promises: Promise<void>[] = [];

    for (let ty = yStart; ty <= yEnd; ty++) {
        if (ty < 0 || ty >= n) continue; // niente wrap verticale
        for (let tx = xStart; tx <= xEnd; tx++) {
            const wx = wrapX(tx, n);        // wrap orizzontale
            const url = `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`;
            const dx = tx * TILE - x0;
            const dy = ty * TILE - y0;

            promises.push(
                loadImg(url).then((img) => {
                    ctx.drawImage(img, dx, dy);
                })
            );
        }
    }

    await Promise.all(promises);

    // Attribuzione minima (obbligatoria)
    if (drawAttribution) {
        const pad = Math.round(8 * scale);
        const text = "© OpenStreetMap contributors";
        ctx.font = `${Math.round(10 * scale)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        const metrics = ctx.measureText(text);
        const tw = metrics.width;
        const th = Math.round(12 * scale);

        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(canvasW - tw - pad * 2, canvasH - th - pad * 2, tw + pad * 2, th + pad * 2);
        ctx.fillStyle = "#000";
        ctx.fillText(text, canvasW - tw - pad, canvasH - pad - Math.round(2 * scale));
    }

    const dataUrl = c.toDataURL("image/png");
    return { dataUrl, width: canvasW, height: canvasH };
}
