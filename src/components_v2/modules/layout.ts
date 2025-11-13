// src/components_v2/modules/layout.ts

export type Pt = { x: number; y: number };

const EPS = 0.5;
const deg2rad = (d: number) => (d * Math.PI) / 180;

/* ------------------ utility base ------------------ */
function centroid(poly: Pt[]) {
    let x = 0, y = 0;
    for (const p of poly) { x += p.x; y += p.y; }
    const n = Math.max(1, poly.length);
    return { x: x / n, y: y / n };
}
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function rot(p: Pt, theta: number): Pt {
    const c = Math.cos(theta), s = Math.sin(theta);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt { return rot(sub(p, O), -theta); }
function localToWorld(p: Pt, O: Pt, theta: number): Pt { return add(rot(p, theta), O); }

/* ------------------ point in poly inclusivo ------------------ */
function pointInPolyInclusive(pt: Pt, poly: Pt[]): boolean {
    const n = poly.length;
    if (n < 3) return false;

    // bordo
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[j], b = poly[i];
        const crossV = (pt.y - a.y) * (b.x - a.x) - (pt.x - a.x) * (b.y - a.y);
        if (Math.abs(crossV) < EPS) {
            const dot = (pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y);
            if (dot >= -EPS) {
                const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
                if (dot <= len2 + EPS) return true;
            }
        }
    }

    // ray casting
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersects = (yi > pt.y) !== (yj > pt.y);
        if (intersects) {
            const xInt = ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi;
            if (xInt >= pt.x - EPS) inside = !inside;
        }
    }
    return inside;
}

/* ------------------ trova segmenti orizzontali a quota y ------------------ */
/** Ritorna una lista di [minX,maxX] (in locale) ordinata per minX. */
function horizontalSegments(polyLocal: Pt[], y: number): Array<{ minX: number; maxX: number }> {
    const xs: number[] = [];
    const n = polyLocal.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = polyLocal[j], b = polyLocal[i];
        // consideriamo solo gli edge che attraversano y
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (y < minY - 1e-6 || y > maxY + 1e-6) continue;
        if (Math.abs(a.y - b.y) < 1e-6) continue; // edge orizzontale → lo saltiamo per semplicità
        const t = (y - a.y) / (b.y - a.y);
        const x = a.x + t * (b.x - a.x);
        xs.push(x);
    }
    xs.sort((a, b) => a - b);
    const segs: Array<{ minX: number; maxX: number }> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
        segs.push({ minX: xs[i], maxX: xs[i + 1] });
    }
    return segs;
}

/* ------------------ tipi export ------------------ */
export type AutoRect = { cx: number; cy: number; wPx: number; hPx: number; angleDeg: number };
type Anchor = 'start' | 'center' | 'end';
const normPhase = (p: number) => {
    if (!isFinite(p)) return 0;
    let r = p % 1;
    if (r < 0) r += 1;
    return r;
};

/* ------------------ funzione principale ------------------ */
export function computeAutoLayoutRects(args: {
    polygon: Pt[];
    mppImage: number;
    azimuthDeg?: number;                       // se assente → usa edge più lungo / più dritto
    orientation: 'portrait' | 'landscape';
    panelSizeM: { w: number; h: number };
    spacingM: number;
    marginM: number;
    phaseX?: number;
    phaseY?: number;
    anchorX?: Anchor;
    anchorY?: Anchor;
    coverageRatio?: number;
}): AutoRect[] {
    const {
        polygon,
        mppImage,
        azimuthDeg,
        orientation,
        panelSizeM,
        spacingM,
        marginM,
        phaseX = 0,
        phaseY = 0,
        anchorX = 'start',
        anchorY = 'start',
        coverageRatio = 1,
    } = args;

    if (!polygon.length || !mppImage) return [];

    // m → px
    const px = (m: number) => m / mppImage;
    const panelW = px(orientation === 'portrait' ? panelSizeM.w : panelSizeM.h);
    const panelH = px(orientation === 'portrait' ? panelSizeM.h : panelSizeM.w);
    const gap = px(spacingM);
    const marginPx = Math.max(0, px(marginM));      // randabstand in px

    /* ---------- orientamento della falda (versione "intelligente") ---------- */
    let theta: number;
    if (typeof azimuthDeg === 'number') {
        theta = deg2rad(azimuthDeg);
    } else {
        // raccogli i lati significativi
        type EdgeInfo = { len: number; angle: number };
        const edges: EdgeInfo[] = [];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len = Math.hypot(vx, vy);
            if (len < 2) continue; // scarta segmenti molto piccoli
            const ang = Math.atan2(vy, vx); // rad
            edges.push({ len, angle: ang });
        }

        if (!edges.length) {
            theta = 0;
        } else {
            // lato più lungo in assoluto
            const longest = edges.reduce((acc, e) => (e.len > acc.len ? e : acc), edges[0]);
            const longestLen = longest.len;

            // cerchiamo lati quasi orizzontali o quasi verticali
            const AXIS_TOL = 10 * Math.PI / 180; // ±10°
            const axisCandidates = edges.filter((e) => {
                const angAbs = Math.abs(e.angle);
                const ang90 = Math.abs(Math.PI / 2 - angAbs);
                const isHoriz = angAbs < AXIS_TOL || Math.abs(Math.PI - angAbs) < AXIS_TOL;
                const isVert = ang90 < AXIS_TOL;
                return isHoriz || isVert;
            });

            const MIN_RATIO = 0.75; // almeno il 75% del più lungo
            let chosen: EdgeInfo | null = null;
            if (axisCandidates.length) {
                const bestAxis = axisCandidates.reduce(
                    (acc, e) => (e.len > acc.len ? e : acc),
                    axisCandidates[0]
                );
                if (bestAxis.len >= longestLen * MIN_RATIO) {
                    chosen = bestAxis;
                }
            }

            theta = (chosen ?? longest).angle;
            // normalizza a [0, π)
            if (theta < 0) theta += Math.PI;
        }
    }
    const angleDeg = (theta * 180) / Math.PI;
    const O = centroid(polygon);

    // poligono in locale
    const polyLocal = polygon.map((p) => worldToLocal(p, O, theta));

    // bbox locale (serve solo per Y)
    let minY = Infinity, maxY = -Infinity;
    for (const p of polyLocal) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minY)) return [];

    // calcolo delle righe possibili (in alto → in basso)
    const cellW = panelW + gap;
    const cellH = panelH + gap;

    // partiamo da minY + marginPx e finiamo a maxY - marginPx
    const rowsY: number[] = [];
    for (let y = minY + marginPx; y + panelH <= maxY - marginPx + 1e-6; y += cellH) {
        rowsY.push(y);
    }

    // applichiamo coverageRatio (es. 0.5 = metà delle righe)
    const maxRows = rowsY.length;
    const rowsToUse = Math.max(
        1,
        Math.min(maxRows, Math.round(maxRows * Math.max(0.01, Math.min(1, coverageRatio))))
    );
    const usedRows = rowsY.slice(0, rowsToUse); // sempre dall’alto verso il basso

    const out: AutoRect[] = [];

    for (let rowIdx = 0; rowIdx < usedRows.length; rowIdx++) {
        const y = usedRows[rowIdx];

        // trova tutti i segmenti orizzontali del tetto a quota y e a quota y+panelH
        // (controlliamo entrambe le quote e prendiamo l'intersezione per evitare tagli)
        const segsTop = horizontalSegments(polyLocal, y);
        const segsBottom = horizontalSegments(polyLocal, y + panelH);

        if (!segsTop.length || !segsBottom.length) continue;

        // per ogni segmento in alto cerchiamo un segmento in basso che si sovrappone
        // e prendiamo il più lungo di tutti
        let bestSeg: { minX: number; maxX: number } | null = null;
        let bestLen = -1;

        for (const sTop of segsTop) {
            for (const sBot of segsBottom) {
                const minX = Math.max(sTop.minX, sBot.minX);
                const maxX = Math.min(sTop.maxX, sBot.maxX);
                if (maxX - minX >= panelW - 1e-6) {
                    const len = maxX - minX;
                    if (len > bestLen) {
                        bestLen = len;
                        bestSeg = { minX, maxX };
                    }
                }
            }
        }

        if (!bestSeg) continue;

        // applica il margine orizzontale ai bordi del segmento
        let segMinX = bestSeg.minX + marginPx;
        let segMaxX = bestSeg.maxX - marginPx;
        if (segMaxX - segMinX < panelW) continue;

        // eventuale ancoraggio + fase sulla X del segmento
        const spanX = segMaxX - segMinX;
        const maxCols = Math.max(0, Math.floor((spanX - panelW + 1e-6) / cellW) + 1);
        const usedW = maxCols > 0 ? maxCols * panelW + (maxCols - 1) * gap : 0;
        const remX = Math.max(0, spanX - usedW);

        const anchorOffsetX =
            anchorX === 'end' ? remX : anchorX === 'center' ? remX / 2 : 0;

        const phx = normPhase(phaseX);
        let startX = segMinX + anchorOffsetX + phx * cellW;

        // ora posiamo i pannelli in questa riga
        for (let x = startX; x + panelW <= segMaxX + 1e-6; x += cellW) {
            // corner locali del pannello
            const cornersLocal: Pt[] = [
                { x, y },
                { x: x + panelW, y },
                { x: x + panelW, y: y + panelH },
                { x, y: y + panelH },
            ];

            // sicurezza aggiuntiva: tutti i corner devono essere dentro al tetto locale
            const ok = cornersLocal.every((c) => pointInPolyInclusive(c, polyLocal));
            if (!ok) continue;

            // centro in world
            const cx = x + panelW / 2;
            const cy = y + panelH / 2;
            const Cw = localToWorld({ x: cx, y: cy }, O, theta);

            out.push({
                cx: Cw.x,
                cy: Cw.y,
                wPx: panelW,
                hPx: panelH,
                angleDeg,
            });
        }
    }

    return out;
}
