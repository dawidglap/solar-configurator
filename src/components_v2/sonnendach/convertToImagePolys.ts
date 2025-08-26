// sonnendach/convertToImagePolys.ts
import { lonLatToImagePx } from "../utils/geo";
import type { RoofArea, Pt } from "../state/plannerV2Store";
import type { SonnendachPoly } from "./fetchRoofPolys";

export function polysToRoofAreas(
    polys: SonnendachPoly[],
    snapshot: { bbox3857?: any; width?: number; height?: number }
): RoofArea[] {
    if (!snapshot.bbox3857 || !snapshot.width || !snapshot.height) return [];

    return polys.map((p, idx) => {
        const points: Pt[] = p.ring.map(([lat, lon]) =>
            lonLatToImagePx(snapshot as any, lon, lat)
        );
        return {
            id: `roof_sd_${Date.now().toString(36)}_${idx}`,
            name: `Dach ${idx + 1}`,
            points,
            tiltDeg: typeof p.attrs.neigung === "number" ? p.attrs.neigung : undefined,
            azimuthDeg: typeof p.attrs.ausrichtung === "number" ? p.attrs.ausrichtung : undefined,
            source: "sonnendach",
        };
    });
}
