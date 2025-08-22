export type StaticMapOpts = {
    lat: number; // center
    lon: number;
    zoom: number; // integer 0..22 (tipico 18 per tetti)
    width: number; // px immagine
    height: number; // px immagine
    scale?: 1 | 2; // retina 2x
    style?: 'streets' | 'satellite'; // stile semplice
};

export function buildMapTilerStaticURL(opts: StaticMapOpts) {
    const {
        lat, lon, zoom, width, height,
        scale = 2,
        style = 'streets',
    } = opts;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) throw new Error('Missing NEXT_PUBLIC_MAPTILER_KEY');

    const styleId =
        style === 'satellite' ? 'satellite' : 'streets';
    // MapTiler Static API
    // https://api.maptiler.com/maps/{style}/static/{lon},{lat},{zoom}/{width}x{height}@{scale}.png?key=KEY
    const url = `https://api.maptiler.com/maps/${styleId}/static/${lon},${lat},${zoom}/${width}x${height}@${scale}.png?key=${key}`;
    return { url, scale };
}

// metri per pixel all'equatore: 156543.03392 m/px @zoom 0 su tile 256px
export function metersPerPixelAtLat(latDeg: number, zoom: number, scale = 1) {
    const latRad = (latDeg * Math.PI) / 180;
    const mpp = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
    // se l'immagine è @2x (retina), ogni px rappresenta metà dell'area → dividiamo per scale
    return mpp / scale;
}
