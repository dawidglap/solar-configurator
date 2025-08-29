// src/components_v2/sonnendach/fetchRoofPolys.ts
export type SonnendachPoly = {
    ring: [number, number][]; // [lat, lon][] in WGS84
    attrs: {
        id?: string | number;
        ausrichtung?: number; // azimuth in °
        neigung?: number;     // tilt in °
        dach_eignung?: string;
    };
};

export async function fetchSonnendachPolygons(lat: number, lon: number): Promise<SonnendachPoly[]> {
    const url = "https://api3.geo.admin.ch/rest/services/energie/MapServer/identify";
    const params = new URLSearchParams({
        geometryType: "esriGeometryPoint",
        geometry: `${lon},${lat}`,
        sr: "4326",
        layers: "all:ch.bfe.solarenergie-eignung-daecher",
        tolerance: "8",
        mapExtent: `${lon - 0.002},${lat - 0.002},${lon + 0.002},${lat + 0.002}`,
        imageDisplay: "600,400,96",
        lang: "de",
    });

    const res = await fetch(`${url}?${params.toString()}`);
    if (!res.ok) throw new Error("Sonnendach API Fehler");
    const data: any = await res.json();

    const out: SonnendachPoly[] = [];
    const results: any[] = Array.isArray(data?.results) ? data.results : [];

    for (const item of results) {
        // GeoAdmin: geometry.rings: Array of rings; each ring is an array of [x=lon, y=lat]
        const rings = item?.geometry?.rings as [number, number][][] | undefined;
        if (!Array.isArray(rings)) continue;

        const attrs = item?.attributes ?? {};

        for (const ring of rings) {
            // API è [x=lon, y=lat] → convertiamo a [lat,lon]
            const latlon: [number, number][] = (ring as [number, number][])
                .map(([x, y]) => [y, x] as [number, number]);

            out.push({
                ring: latlon,
                attrs: {
                    id: (attrs.id as string | number | undefined),
                    ausrichtung:
                        typeof attrs.ausrichtung === "number"
                            ? attrs.ausrichtung
                            : typeof attrs.ausrichtung === "string"
                                ? parseFloat(attrs.ausrichtung) || undefined
                                : undefined,
                    neigung:
                        typeof attrs.neigung === "number"
                            ? attrs.neigung
                            : typeof attrs.neigung === "string"
                                ? parseFloat(attrs.neigung) || undefined
                                : undefined,
                    dach_eignung:
                        typeof attrs.dach_eignung === "string"
                            ? attrs.dach_eignung
                            : typeof attrs.dach_eignung === "number"
                                ? String(attrs.dach_eignung)
                                : undefined,
                },
            });
        }
    }

    return out;
}
