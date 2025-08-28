// src/components_v2/modules/panels/math.ts

export type Pt = { x: number; y: number };

/** Angolo (radiani) del lato più lungo del poligono */
export function longestEdgeAngle(poly: Pt[]) {
    let bestLen = -1, bestTheta = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const vx = b.x - a.x, vy = b.y - a.y;
        const len = Math.hypot(vx, vy);
        if (len > bestLen) { bestLen = len; bestTheta = Math.atan2(vy, vx); }
    }
    return bestTheta;
}

/** Differenza assoluta tra due angoli in gradi (0..180) */
export function angleDiffDeg(a: number, b: number) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}
