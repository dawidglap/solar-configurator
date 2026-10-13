// src/components_v2/canvas/normalizeRoof.ts
import { simplifySonnendachPolygon } from "@/lib/planning/sonnendachPolygon";

export type Pt = { x: number; y: number };

export type NormalizeOpts = {
    mergeTolM?: number;        // m
    collinearEpsDeg?: number;  // °
    minSpurM?: number;         // m
    maxPasses?: number;
};

export function normalizeRoof(srcPoints: Pt[], mpp: number, opts: NormalizeOpts = {}): Pt[] {
    return simplifySonnendachPolygon(srcPoints, mpp, {
        mergeDistanceM: opts.mergeTolM,
        collinearAngleDeg: opts.collinearEpsDeg,
        shortEdgeM: opts.minSpurM,
        maxPasses: opts.maxPasses,
    });
}
