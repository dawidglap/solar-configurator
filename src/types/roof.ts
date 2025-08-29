// src/types/roof.ts
export type LatLng = [number, number];

export interface RoofAttributes {
    id: string;                         // obbligatorio: lo usi nella selezione
    dach_eignung?: number | string;     // grezzo dall’API (può essere string/num)
    ausrichtung?: number | string;
    [key: string]: any;
}

export interface RoofPolygon {
    coords: LatLng[];                   // [lat,lng][]
    eignung: number;                    // 🔒 sempre number dopo la normalizzazione
    attributes: RoofAttributes;
}
