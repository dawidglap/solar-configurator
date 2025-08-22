import type { GeocodeResult } from '../geocoding/AddressSearch';

export async function geocodeMapTiler(
    query: string,
    opts: { country?: string; language?: string } = {}
): Promise<GeocodeResult | null> {
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key || !query.trim()) return null;
    const country = opts.country ?? 'ch';
    const language = opts.language ?? 'de';
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
        query
    )}.json?key=${key}&limit=1&language=${language}&country=${country}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const fc = await res.json();
    const f = fc?.features?.[0];
    if (!f) return null;
    const coord =
        f?.center ??
        (Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : null);
    const lon = Number(coord?.[0]);
    const lat = Number(coord?.[1]);
    const label =
        f?.place_name_de ??
        f?.place_name ??
        f?.text ??
        f?.properties?.label ??
        f?.properties?.name ??
        `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    return { label, lat, lon };
}
