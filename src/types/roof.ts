// src/types/roof.ts
export interface RoofAttributes {
    dach_eignung: number;
    ausrichtung: number;
    [key: string]: string | number | undefined; // for extra flexibility if needed
}

export type RoofPolygon = {
    coords: number[][];
    eignung: number;
    attributes: RoofAttributes;
};
