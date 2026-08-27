// src/components_v2/modules/panels/usePanelDragSnap.ts
'use client';

import React from 'react';
import type Konva from 'konva';
import type { Pt } from './math';
import { angleDiffDeg } from './math';
import { createLatestFrameScheduler, type FrameScheduler } from '../../canvas/performance/latestFrameScheduler';

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
    normalizeCandidate?: (id: string, cx: number, cy: number) => Pt | null;

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

export type StaticPanelUV = {
    id: string;
    u: number;
    v: number;
    hw: number;
    hh: number;
};

export function buildPanelDragStaticGeometry(input: {
    allPanels: PanelInst[];
    roofId: string;
    excludeId: string;
    defaultAngleDeg: number;
    project: ProjectFn;
}): StaticPanelUV[] {
    return input.allPanels.flatMap((panel) => {
        if (panel.roofId !== input.roofId || panel.id === input.excludeId) return [];
        const angle = (typeof panel.angleDeg === 'number' ? panel.angleDeg : input.defaultAngleDeg) || 0;
        if (!isParallel(angle, input.defaultAngleDeg)) return [];
        const uv = input.project({ x: panel.cx, y: panel.cy });
        return [{
            id: panel.id,
            u: uv.u,
            v: uv.v,
            hw: panel.wPx / 2,
            hh: panel.hPx / 2,
        }];
    });
}

export function resolveNoOverlapCached(input: {
    u: number;
    v: number;
    hw: number;
    hh: number;
    gapPx: number;
    panels: StaticPanelUV[];
}): UV {
    let { u, v } = input;
    for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (const panel of input.panels) {
            const minU = input.hw + panel.hw + input.gapPx;
            const minV = input.hh + panel.hh + input.gapPx;
            const du = u - panel.u;
            const dv = v - panel.v;
            const penU = minU - Math.abs(du);
            const penV = minV - Math.abs(dv);
            if (penU > 0 && penV > 0) {
                if (penU < penV) u = panel.u + (du >= 0 ? minU : -minU);
                else v = panel.v + (dv >= 0 ? minV : -minV);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return { u, v };
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
    normalizeCandidate,
}: Args) {
    // Refs stato drag
    const stageRef = React.useRef<any>(null);
    const draggingIdRef = React.useRef<string | null>(null);
    const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);
    const dragSizeHalfRef = React.useRef<{ hw: number; hh: number } | null>(null);
    const draggedNodeRef = React.useRef<Konva.Node | null>(null);
    const draggedSelectionNodeRef = React.useRef<Konva.Node | null>(null);
    const dragStartPanelRef = React.useRef<PanelInst | null>(null);
    const finalPositionRef = React.useRef<Pt | null>(null);
    const frameRef = React.useRef<FrameScheduler<Pt> | null>(null);

    // Guide calcolate (altri pannelli + bordi tetto)
    const guidesRef = React.useRef<{
        uCenters: number[];
        uEdges: number[];
        vCenters: number[];
        vEdges: number[];
    }>({ uCenters: [], uEdges: [], vCenters: [], vEdges: [] });

    const hintURef = React.useRef<Konva.Line | null>(null);
    const hintVRef = React.useRef<Konva.Line | null>(null);

    const setGuide = React.useCallback((ref: React.MutableRefObject<Konva.Line | null>, points: number[] | null) => {
        const node = ref.current;
        if (!node) return;
        node.points(points ?? []);
        node.visible(Boolean(points));
    }, []);

    const clearHints = React.useCallback(() => {
        setGuide(hintURef, null);
        setGuide(hintVRef, null);
    }, [setGuide]);

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
    const staticPanelsRef = React.useRef<Array<{ id: string; u: number; v: number; hw: number; hh: number }>>([]);

    const resolveNoOverlap = React.useCallback(
        (u0: number, v0: number, hw: number, hh: number) => {
            return resolveNoOverlapCached({
                u: u0,
                v: v0,
                hw,
                hh,
                gapPx,
                panels: staticPanelsRef.current,
            });
        },
        [gapPx]
    );

    const endDrag = React.useCallback((commit = true) => {
        frameRef.current?.flush();
        const st = stageRef.current;
        if (st) st.off('.paneldrag');
        if (commit && draggingIdRef.current && finalPositionRef.current) {
            updatePanel(draggingIdRef.current, {
                cx: finalPositionRef.current.x,
                cy: finalPositionRef.current.y,
            });
        } else if (!commit && draggedNodeRef.current && dragStartPanelRef.current) {
            draggedNodeRef.current.position({
                x: dragStartPanelRef.current.cx,
                y: dragStartPanelRef.current.cy,
            });
            draggedNodeRef.current.getLayer()?.batchDraw();
            draggedSelectionNodeRef.current?.position({
                x: dragStartPanelRef.current.cx,
                y: dragStartPanelRef.current.cy,
            });
        }
        frameRef.current?.cancel();
        draggingIdRef.current = null;
        startOffsetRef.current = null;
        dragSizeHalfRef.current = null;
        draggedNodeRef.current = null;
        draggedSelectionNodeRef.current = null;
        dragStartPanelRef.current = null;
        finalPositionRef.current = null;
        clearHints();
        onDragEnd?.();
    }, [onDragEnd, clearHints, updatePanel]);

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
            draggedNodeRef.current = e.target;
            draggedSelectionNodeRef.current = st.findOne(`#panel-selection-${panelId}`) ?? null;
            dragStartPanelRef.current = { ...p };
            finalPositionRef.current = { x: p.cx, y: p.cy };

            staticPanelsRef.current = buildPanelDragStaticGeometry({
                allPanels,
                roofId,
                excludeId: panelId,
                defaultAngleDeg,
                project,
            });

            // precalcola guide (altri pannelli + bordi tetto)
            guidesRef.current = buildGuides(panelId);
            clearHints();

            const ns = '.paneldrag';
            st.off(ns);

            const applyPointerFrame = (q: Pt) => {
                const id = draggingIdRef.current;
                const off = startOffsetRef.current;
                const sz = dragSizeHalfRef.current;
                if (!id || !off || !sz) return;

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
                const separated = resolveNoOverlap(bestU, bestV, sz.hw, sz.hh);
                bestU = separated.u;
                bestV = separated.v;

                // hint lines
                if (snappedU) {
                    const a = fromUV(bestU, uvBounds.minV);
                    const b = fromUV(bestU, uvBounds.maxV);
                    setGuide(hintURef, [a.x, a.y, b.x, b.y]);
                } else setGuide(hintURef, null);

                if (snappedV) {
                    const a = fromUV(uvBounds.minU, bestV);
                    const b = fromUV(uvBounds.maxU, bestV);
                    setGuide(hintVRef, [a.x, a.y, b.x, b.y]);
                } else setGuide(hintVRef, null);

                const snapped = fromUV(bestU, bestV);
                if (reservedGuard && !reservedGuard(snapped.x, snapped.y)) return;
                const normalized = normalizeCandidate
                    ? normalizeCandidate(id, snapped.x, snapped.y)
                    : snapped;
                if (!normalized) return;

                finalPositionRef.current = normalized;
                const node = draggedNodeRef.current;
                if (node) {
                    node.position({ x: normalized.x, y: normalized.y });
                    draggedSelectionNodeRef.current?.position({ x: normalized.x, y: normalized.y });
                    node.getLayer()?.batchDraw();
                }
            };

            frameRef.current = createLatestFrameScheduler(applyPointerFrame);

            st.on('mousemove' + ns + ' touchmove' + ns, () => {
                const mp = st.getPointerPosition();
                if (!mp) return;
                frameRef.current?.schedule(stageToImg(mp.x, mp.y));
            });

            st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, () => endDrag(true));
            st.on('mouseleave' + ns, () => endDrag(true));
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
            normalizeCandidate,
            buildGuides,
            setGuide,
            defaultAngleDeg,
            roofId,
        ]
    );

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !draggingIdRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            endDrag(false);
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => {
            frameRef.current?.cancel();
            try { stageRef.current?.off('.paneldrag'); } catch { }
            window.removeEventListener('keydown', onKeyDown, { capture: true });
        };
    }, [endDrag]);

    return {
        startDrag,
        hintURef, hintVRef,
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
