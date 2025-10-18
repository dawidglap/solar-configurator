// src/components_v2/canvas/normalizeRoof.ts
export type Pt = { x: number; y: number };

export type NormalizeOpts = {
    mergeTolM?: number;        // m
    collinearEpsDeg?: number;  // °
    minSpurM?: number;         // m
    maxPasses?: number;
};

function len(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }
function at(points: Pt[], i: number): Pt { const n = points.length; return points[(i + n) % n]; }
function angleBetween(u: Pt, v: Pt) {
    const dot = u.x * v.x + u.y * v.y;
    const nu = Math.hypot(u.x, u.y), nv = Math.hypot(v.x, v.y);
    if (nu === 0 || nv === 0) return 0;
    let c = dot / (nu * nv); c = Math.max(-1, Math.min(1, c));
    return Math.acos(c); // [0,π]
}
function dedupeTol(arr: Pt[], tolPx: number) {
    const out: Pt[] = [];
    for (let i = 0; i < arr.length; i++) {
        const a = arr[i], b = arr[(i + 1) % arr.length];
        if (len(a, b) < tolPx) continue;
        out.push(a);
    }
    return out;
}

export function normalizeRoof(srcPoints: Pt[], mpp: number, opts: NormalizeOpts = {}): Pt[] {
    const mergeTolPx = (opts.mergeTolM ?? 0.35) / mpp;
    const collinearEps = ((opts.collinearEpsDeg ?? 2) * Math.PI) / 180;
    const minSpurPx = (opts.minSpurM ?? 1.0) / mpp;
    const maxPasses = opts.maxPasses ?? 3;

    let pts = srcPoints.slice();
    if (pts.length > 1) {
        const first = pts[0], last = pts[pts.length - 1];
        if (len(first, last) < mergeTolPx) pts = pts.slice(0, -1);
    }
    if (pts.length < 3) return srcPoints;

    const runPass = (): { changed: boolean; next: Pt[] } => {
        let changed = false;

        // 1) merge vicini
        const s1: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
            const a = at(pts, i), b = at(pts, i + 1);
            if (len(a, b) < mergeTolPx) { changed = true; i++; s1.push(a); } else { s1.push(a); }
        }
        pts = dedupeTol(s1, mergeTolPx);

        // 2) rimuovi quasi-collineari
        const s2: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
            const prev = at(pts, i - 1), cur = at(pts, i), next = at(pts, i + 1);
            const u = { x: cur.x - prev.x, y: cur.y - prev.y };
            const v = { x: next.x - cur.x, y: next.y - cur.y };
            const dev = Math.abs(Math.PI - angleBetween(u, v));
            if (dev < collinearEps) { changed = true; continue; }
            s2.push(cur);
        }
        pts = dedupeTol(s2, mergeTolPx);

        // 3) elimina spur corti e quasi paralleli
        const s3: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
            const prev = at(pts, i - 1), cur = at(pts, i), next = at(pts, i + 1);
            const l1 = len(prev, cur), l2 = len(cur, next);
            const u = { x: cur.x - prev.x, y: cur.y - prev.y };
            const v = { x: next.x - cur.x, y: next.y - cur.y };
            const dev = Math.abs(Math.PI - angleBetween(u, v));
            const spur = (l1 < minSpurPx || l2 < minSpurPx) && dev < collinearEps;
            if (spur) { changed = true; continue; }
            s3.push(cur);
        }
        pts = dedupeTol(s3, mergeTolPx);

        // 4) collassa run collineari (tieni solo estremi)
        const s4: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
            const prev = at(pts, i - 1), cur = at(pts, i), next = at(pts, i + 1);
            const u = { x: cur.x - prev.x, y: cur.y - prev.y };
            const v = { x: next.x - cur.x, y: next.y - cur.y };
            const nu = Math.hypot(u.x, u.y), nv = Math.hypot(v.x, v.y);
            if (nu === 0 || nv === 0) continue;
            let cos = (u.x * v.x + u.y * v.y) / (nu * nv);
            cos = Math.max(-1, Math.min(1, cos));
            const dev = Math.abs(Math.PI - Math.acos(cos));
            if (dev < collinearEps) { changed = true; continue; }
            s4.push(cur);
        }
        pts = dedupeTol(s4, mergeTolPx);

        if (pts.length < 3) pts = srcPoints.slice();
        return { changed, next: pts };
    };

    let changed = false;
    for (let pass = 0; pass < maxPasses; pass++) {
        const res = runPass();
        changed = changed || res.changed;
        pts = res.next;
        if (!res.changed) break;
    }
    return changed ? pts : srcPoints;
}
