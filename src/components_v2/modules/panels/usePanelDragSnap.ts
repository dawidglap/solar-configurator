// src/components_v2/modules/panels/usePanelDragSnap.ts
'use client';

import React from 'react';
import type { Pt } from './math';
import { angleDiffDeg } from './math';

export type UV = { u: number; v: number };
export type UVBounds = { minU: number; maxU: number; minV: number; maxV: number };

export type ProjectFn = (pt: Pt) => UV;              // Img → UV locali falda
export type FromUVFn = (u: number, v: number) => Pt; // UV → Img

export type PanelInst = {
    id: string;
    roofId: string;
    cx: number;
    cy: number;
    wPx: number;
    hPx: number;
    angleDeg?: number;
};

type Args = {
    // geometria/assiali della falda
    defaultAngleDeg: number;
    project: ProjectFn;
    fromUV: FromUVFn;
    uvBounds: UVBounds;

    // dati
    allPanels: PanelInst[];
    roofId: string;

    // IO
    stageToImg?: (x: number, y: number) => Pt;
    updatePanel: (id: string, patch: Partial<PanelInst>) => void;

    // UX
    onSelect?: (id?: string) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;

    // snap
    snapPxImg: number;      // soglia in PX IMMAGINE (già convertita fuori)
    edgeMarginPx?: number;  // margine interno ai bordi tetto in px immagine

    // anti-overlap
    gapPx?: number;         // distanza minima fra moduli (px immagine) — es. spacingM/mpp

    // ⛔️ guardia zone: true = posizione consentita, false = vietata
    reservedGuard?: (cx: number, cy: number) => boolean;
};

function isParallel(angleA: number, angleB: number) {
    const diff = angleDiffDeg(angleA, angleB);
    return Math.min(diff, Math.abs(diff - 180)) <= 5;
}

export function usePanelDragSnap({
    defaultAngleDeg,
    project,
    fromUV,
    uvBounds,
    allPanels,
    roofId,
    stageToImg,
    updatePanel,
    onSelect,
    onDragStart,
    onDragEnd,
    snapPxImg,
    edgeMarginPx = 0,
    gapPx = 0,
    reservedGuard,
}: Args) {
    // Refs stato drag
    const stageRef = React.useRef<any>(null);
    const draggingIdRef = React.useRef<string | null>(null);
    const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);
    const dragSizeHalfRef = React.useRef<{ hw: number; hh: number } | null>(null);

    // Guide calcolate (altri pannelli + bordi tetto)
    const guidesRef = React.useRef<{
        uCenters: number[];
        uEdges: number[];
        vCenters: number[];
        vEdges: number[];
    }>({ uCenters: [], uEdges: [], vCenters: [], vEdges: [] });

    // Hints visuali (linee)
    const [hintU, setHintU] = React.useState<number[] | null>(null);
    const [hintV, setHintV] = React.useState<number[] | null>(null);

    const clearHints = React.useCallback(() => {
        setHintU(null);
        setHintV(null);
    }, []);

    const buildGuides = React.useCallback(
        (excludeId?: string) => {
            const uCenters: number[] = [];
            const uEdges: number[] = [];
            const vCenters: number[] = [];
            const vEdges: number[] = [];

            // 1) guide dagli ALTRI pannelli (paralleli)
            for (const t of allPanels) {
                if (t.roofId !== roofId || t.id === excludeId) continue;

                const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
                if (!isParallel(tAngle, defaultAngleDeg)) continue;

                const { u, v } = project({ x: t.cx, y: t.cy });
                uCenters.push(u);
                uEdges.push(u - t.wPx / 2, u + t.wPx / 2);
                vCenters.push(v);
                vEdges.push(v - t.hPx / 2, v + t.hPx / 2);
            }

            // 2) guide dai BORDI TETTO (interni del margine)
            const m = Math.max(0, edgeMarginPx || 0);

            if (uvBounds.maxU - uvBounds.minU > 2 * m) {
                uEdges.push(uvBounds.minU + m, uvBounds.maxU - m);
            }
            if (uvBounds.maxV - uvBounds.minV > 2 * m) {
                vEdges.push(uvBounds.minV + m, uvBounds.maxV - m);
            }

            return { uCenters, uEdges, vCenters, vEdges };
        },
        [allPanels, roofId, defaultAngleDeg, project, uvBounds, edgeMarginPx]
    );

    // --- risoluzione overlap (spinge fuori lungo asse con penetrazione minore)
    const resolveNoOverlap = React.useCallback(
        (u0: number, v0: number, hw: number, hh: number, excludeId: string) => {
            let u = u0, v = v0;
            for (let pass = 0; pass < 4; pass++) {
                let changed = false;

                for (const t of allPanels) {
                    if (t.roofId !== roofId || t.id === excludeId) continue;

                    const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
                    if (!isParallel(tAngle, defaultAngleDeg)) continue;

                    const uv = project({ x: t.cx, y: t.cy });
                    const thw = t.wPx / 2, thh = t.hPx / 2;

                    const minU = hw + thw + gapPx;
                    const minV = hh + thh + gapPx;

                    const du = u - uv.u;
                    const dv = v - uv.v;

                    const penU = minU - Math.abs(du);
                    const penV = minV - Math.abs(dv);

                    if (penU > 0 && penV > 0) {
                        if (penU < penV) {
                            u = uv.u + (du >= 0 ? minU : -minU);
                        } else {
                            v = uv.v + (dv >= 0 ? minV : -minV);
                        }
                        changed = true;
                    }
                }

                if (!changed) break;
            }
            return { u, v };
        },
        [allPanels, roofId, defaultAngleDeg, project, gapPx]
    );

    const endDrag = React.useCallback(() => {
        const st = stageRef.current;
        if (st) st.off('.paneldrag');
        draggingIdRef.current = null;
        startOffsetRef.current = null;
        dragSizeHalfRef.current = null;
        clearHints();
        onDragEnd?.();
    }, [onDragEnd, clearHints]);

    const startDrag = React.useCallback(
        (panelId: string, e: any) => {
            if (!stageToImg) return;
            e.cancelBubble = true;
            onSelect?.(panelId);
            onDragStart?.();

            const st = e.target.getStage();
            stageRef.current = st;

            const pos = st.getPointerPosition();
            if (!pos) return;
            const mouseImg = stageToImg(pos.x, pos.y);

            const p = allPanels.find((x) => x.id === panelId);
            if (!p) return;

            startOffsetRef.current = { dx: p.cx - mouseImg.x, dy: p.cy - mouseImg.y };
            draggingIdRef.current = panelId;
            dragSizeHalfRef.current = { hw: p.wPx / 2, hh: p.hPx / 2 };

            // precalcola guide (altri pannelli + bordi tetto)
            guidesRef.current = buildGuides(panelId);
            clearHints();

            const ns = '.paneldrag';
            st.off(ns);

            st.on('mousemove' + ns + ' touchmove' + ns, () => {
                const id = draggingIdRef.current;
                const off = startOffsetRef.current;
                const sz = dragSizeHalfRef.current;
                if (!id || !off || !sz) return;

                const mp = st.getPointerPosition();
                if (!mp) return;
                const q = stageToImg(mp.x, mp.y);

                // posizione candidata (px immagine)
                const cand = { x: q.x + off.dx, y: q.y + off.dy };
                const cur = project(cand);

                // --- SNAP 1D su u/v (centri + bordi + margini tetto interni)
                let bestU = cur.u;
                let bestDU = snapPxImg + 1;
                let snappedU = false;

                for (const g of guidesRef.current.uCenters) {
                    const du = Math.abs(cur.u - g);
                    if (du <= snapPxImg && du < bestDU) { bestDU = du; bestU = g; snappedU = true; }
                }
                for (const ePos of guidesRef.current.uEdges) {
                    const cand1 = ePos - sz.hw;
                    const cand2 = ePos + sz.hw;
                    const du1 = Math.abs(cur.u - cand1);
                    const du2 = Math.abs(cur.u - cand2);
                    if (du1 <= snapPxImg && du1 < bestDU) { bestDU = du1; bestU = cand1; snappedU = true; }
                    if (du2 <= snapPxImg && du2 < bestDU) { bestDU = du2; bestU = cand2; snappedU = true; }
                }

                let bestV = cur.v;
                let bestDV = snapPxImg + 1;
                let snappedV = false;

                for (const g of guidesRef.current.vCenters) {
                    const dv = Math.abs(cur.v - g);
                    if (dv <= snapPxImg && dv < bestDV) { bestDV = dv; bestV = g; snappedV = true; }
                }
                for (const ePos of guidesRef.current.vEdges) {
                    const cand1 = ePos - sz.hh;
                    const cand2 = ePos + sz.hh;
                    const dv1 = Math.abs(cur.v - cand1);
                    const dv2 = Math.abs(cur.v - cand2);
                    if (dv1 <= snapPxImg && dv1 < bestDV) { bestDV = dv1; bestV = cand1; snappedV = true; }
                    if (dv2 <= snapPxImg && dv2 < bestDV) { bestDV = dv2; bestV = cand2; snappedV = true; }
                }

                // --- NO-OVERLAP
                const separated = resolveNoOverlap(bestU, bestV, sz.hw, sz.hh, id);
                bestU = separated.u;
                bestV = separated.v;

                // hint lines
                if (snappedU) {
                    const a = fromUV(bestU, uvBounds.minV);
                    const b = fromUV(bestU, uvBounds.maxV);
                    setHintU([a.x, a.y, b.x, b.y]);
                } else setHintU(null);

                if (snappedV) {
                    const a = fromUV(uvBounds.minU, bestV);
                    const b = fromUV(uvBounds.maxU, bestV);
                    setHintV([a.x, a.y, b.x, b.y]);
                } else setHintV(null);

                const snapped = fromUV(bestU, bestV);
                if (reservedGuard && !reservedGuard(snapped.x, snapped.y)) return;

                updatePanel(id, { cx: snapped.x, cy: snapped.y });
            });

            st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
            st.on('mouseleave' + ns, endDrag);
        },
        [
            allPanels,
            onSelect,
            onDragStart,
            endDrag,
            stageToImg,
            updatePanel,
            project,
            fromUV,
            uvBounds,
            snapPxImg,
            clearHints,
            resolveNoOverlap,
            reservedGuard,
            buildGuides,
        ]
    );

    React.useEffect(() => {
        return () => {
            try { stageRef.current?.off('.paneldrag'); } catch { }
        };
    }, []);

    return {
        startDrag,
        hintU, hintV,
    };
}

/* ─────────────────────────────────────────────────────────────
   EXTRA EXPORTS: helpers puri per drag di gruppo (multi-select)
   ───────────────────────────────────────────────────────────── */

export function buildGuidesCommon(params: {
    allPanels: PanelInst[];
    roofId: string;
    defaultAngleDeg: number;
    project: ProjectFn;
    uvBounds: UVBounds;
    edgeMarginPx?: number;
    excludeIds?: Set<string>;
}) {
    const { allPanels, roofId, defaultAngleDeg, project, uvBounds, edgeMarginPx = 0, excludeIds } = params;

    const uCenters: number[] = [];
    const uEdges: number[] = [];
    const vCenters: number[] = [];
    const vEdges: number[] = [];

    for (const t of allPanels) {
        if (t.roofId !== roofId) continue;
        if (excludeIds && excludeIds.has(t.id)) continue;

        const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
        if (!isParallel(tAngle, defaultAngleDeg)) continue;

        const { u, v } = project({ x: t.cx, y: t.cy });
        uCenters.push(u);
        uEdges.push(u - t.wPx / 2, u + t.wPx / 2);
        vCenters.push(v);
        vEdges.push(v - t.hPx / 2, v + t.hPx / 2);
    }

    const m = Math.max(0, edgeMarginPx || 0);
    if (uvBounds.maxU - uvBounds.minU > 2 * m) {
        uEdges.push(uvBounds.minU + m, uvBounds.maxU - m);
    }
    if (uvBounds.maxV - uvBounds.minV > 2 * m) {
        vEdges.push(uvBounds.minV + m, uvBounds.maxV - m);
    }

    return { uCenters, uEdges, vCenters, vEdges };
}

export function snapUVToGuides(params: {
    curU: number;
    curV: number;
    hw: number;
    hh: number;
    guides: { uCenters: number[]; uEdges: number[]; vCenters: number[]; vEdges: number[] };
    snapPxImg: number;
    fromUV: FromUVFn;
    uvBounds: UVBounds;
}) {
    const { curU, curV, hw, hh, guides, snapPxImg, fromUV, uvBounds } = params;

    let bestU = curU, bestDU = snapPxImg + 1, snappedU = false;
    for (const g of guides.uCenters) {
        const du = Math.abs(curU - g);
        if (du <= snapPxImg && du < bestDU) { bestDU = du; bestU = g; snappedU = true; }
    }
    for (const ePos of guides.uEdges) {
        const cand1 = ePos - hw;
        const cand2 = ePos + hw;
        const du1 = Math.abs(curU - cand1);
        const du2 = Math.abs(curU - cand2);
        if (du1 <= snapPxImg && du1 < bestDU) { bestDU = du1; bestU = cand1; snappedU = true; }
        if (du2 <= snapPxImg && du2 < bestDU) { bestDU = du2; bestU = cand2; snappedU = true; }
    }

    let bestV = curV, bestDV = snapPxImg + 1, snappedV = false;
    for (const g of guides.vCenters) {
        const dv = Math.abs(curV - g);
        if (dv <= snapPxImg && dv < bestDV) { bestDV = dv; bestV = g; snappedV = true; }
    }
    for (const ePos of guides.vEdges) {
        const cand1 = ePos - hh;
        const cand2 = ePos + hh;
        const dv1 = Math.abs(curV - cand1);
        const dv2 = Math.abs(curV - cand2);
        if (dv1 <= snapPxImg && dv1 < bestDV) { bestDV = dv1; bestV = cand1; snappedV = true; }
        if (dv2 <= snapPxImg && dv2 < bestDV) { bestDV = dv2; bestV = cand2; snappedV = true; }
    }

    const hintU = snappedU
        ? (() => {
            const a = fromUV(bestU, uvBounds.minV);
            const b = fromUV(bestU, uvBounds.maxV);
            return [a.x, a.y, b.x, b.y] as number[];
        })()
        : null;

    const hintV = snappedV
        ? (() => {
            const a = fromUV(uvBounds.minU, bestV);
            const b = fromUV(uvBounds.maxU, bestV);
            return [a.x, a.y, b.x, b.y] as number[];
        })()
        : null;

    return { bestU, bestV, hintU, hintV };
}
