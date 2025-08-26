// sonnendach/fetchRoofPolys.ts
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
    const data = await res.json();

    const out: SonnendachPoly[] = [];
    for (const item of (data?.results ?? [])) {
        const rings = item.geometry?.rings;
        if (!Array.isArray(rings)) continue;
        const attrs = item.attributes ?? {};
        for (const ring of rings as number[][]) {
            // API è [x=lon, y=lat] → convertiamo a [lat,lon]
            const latlon = ring.map(([x, y]) => [y, x] as [number, number]);
            out.push({
                ring: latlon,
                attrs: {
                    id: attrs.id,
                    ausrichtung: attrs.ausrichtung,
                    neigung: attrs.neigung,
                    dach_eignung: attrs.dach_eignung,
                },
            });
        }
    }
    return out;
}
