// src/types/roof.ts
export type LatLng = [number, number];

export interface RoofAttributes {
    dach_eignung?: number | string;
    ausrichtung?: number | string;
    id: string;                       // ← obbligatorio: serve al renderer/selezione
    [key: string]: any;               // extra campi dall'API
}

export interface RoofPolygon {
    coords: LatLng[];                 // ← non number[][] ma tuple [lat,lng]
    eignung?: number | string;        // a volte l'API manda stringhe
    attributes: RoofAttributes;
}
