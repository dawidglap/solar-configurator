// src/components_v2/modules/fill/computeGridInRect.ts
import type { Pt, PanelSpec } from '@/types/planner';

export type GridParams = {
    rectPoly: Pt[];                // rettangolo RUOTATO: [p1,p2,p3,p4] in px immagine
    mpp: number;                   // metri per pixel
    panel: PanelSpec;              // dal catalogo (widthM, heightM)
    orientation: 'portrait' | 'landscape';
    spacingM: number;
    angleDeg: number;              // stesso usato per preview (roof azimuth + gridAngle + rot UI)
};

export type PanelSlot = {
    cx: number; cy: number;        // centro in px
    wPx: number; hPx: number;      // size in px
    angleDeg: number;              // rotazione assoluta
};

/** punto dentro poligono convesso (il nostro rect è convesso) */
function pointInPoly(p: Pt, poly: Pt[]): boolean {
    // winding per poligono convesso (rettangolo) – veloce
    // (p2 - p1) x (p - p1) ha segno coerente per tutti gli edge
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (cross !== 0) {
            const s = Math.sign(cross);
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
    }
    return true;
}

export function computeGridInRect(params: GridParams): PanelSlot[] {
    const { rectPoly, mpp, panel, orientation, spacingM, angleDeg } = params;

    // Assi ruotati dalla p1→p2 e p2→p3 (coerenti con il rubber-band)
    const [p1, p2, p3, p4] = rectPoly;
    const ux = { x: p2.x - p1.x, y: p2.y - p1.y };
    const uy = { x: p4.x - p1.x, y: p4.y - p1.y };
    const lenUx = Math.hypot(ux.x, ux.y);
    const lenUy = Math.hypot(uy.x, uy.y);
    const ex = { x: ux.x / (lenUx || 1), y: ux.y / (lenUx || 1) };
    const ey = { x: uy.x / (lenUy || 1), y: uy.y / (lenUy || 1) };

    // dimensioni pannello (in px)
    const panWm = orientation === 'portrait' ? panel.widthM : panel.heightM;
    const panHm = orientation === 'portrait' ? panel.heightM : panel.widthM;
    const cellWpx = (panWm + spacingM) / mpp;
    const cellHpx = (panHm + spacingM) / mpp;
    const wPx = panWm / mpp;
    const hPx = panHm / mpp;

    // quante celle intere lungo ciascun asse ci stanno
    const nx = Math.max(0, Math.floor(lenUx / cellWpx));
    const ny = Math.max(0, Math.floor(lenUy / cellHpx));
    if (nx === 0 || ny === 0) return [];

    const out: PanelSlot[] = [];
    for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
            // centro cella (offset da p1) + mezzo pannello per centrare nella cella
            const cx = p1.x + (ix + 0.5) * cellWpx * ex.x + (iy + 0.5) * cellHpx * ey.x;
            const cy = p1.y + (ix + 0.5) * cellWpx * ex.y + (iy + 0.5) * cellHpx * ey.y;

            // check: il centro sta nel rettangolo
            if (!pointInPoly({ x: cx, y: cy }, rectPoly)) continue;

            out.push({ cx, cy, wPx, hPx, angleDeg });
        }
    }
    return out;
}
