// src/components_v2/modules/panels/usePanelDragSnap.ts
'use client';

import React from 'react';
import type { Pt } from './math';
import { angleDiffDeg } from './math';

// Tipi interni
type UV = { u: number; v: number };
type UVBounds = { minU: number; maxU: number; minV: number; maxV: number };

export type ProjectFn = (pt: Pt) => UV;         // Img → UV locali falda
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
    snapPxImg: number; // Soglia in PX IMMAGINE (già convertita fuori dall’hook)
};

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
}: Args) {
    // Refs stato drag
    const stageRef = React.useRef<any>(null);
    const draggingIdRef = React.useRef<string | null>(null);
    const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);
    const dragSizeHalfRef = React.useRef<{ hw: number; hh: number } | null>(null);

    // Guide calcolate dagli altri pannelli
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

            for (const t of allPanels) {
                if (t.roofId !== roofId || t.id === excludeId) continue;

                const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
                // Niente snap tra pannelli con orientazioni molto diverse
                if (angleDiffDeg(tAngle, defaultAngleDeg) > 5) continue;

                const { u, v } = project({ x: t.cx, y: t.cy });
                uCenters.push(u);
                uEdges.push(u - t.wPx / 2, u + t.wPx / 2);
                vCenters.push(v);
                vEdges.push(v - t.hPx / 2, v + t.hPx / 2);
            }
            return { uCenters, uEdges, vCenters, vEdges };
        },
        [allPanels, roofId, defaultAngleDeg, project]
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

            // precalcola guide (escludendo il corrente)
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

                // --- SNAP lungo u ---
                let bestU = cur.u;
                let bestDU = snapPxImg + 1;
                let snappedU = false;

                // centri
                for (const g of guidesRef.current.uCenters) {
                    const du = Math.abs(cur.u - g);
                    if (du <= snapPxImg && du < bestDU) {
                        bestDU = du;
                        bestU = g;
                        snappedU = true;
                    }
                }
                // bordi
                for (const ePos of guidesRef.current.uEdges) {
                    const cand1 = ePos - sz.hw;
                    const cand2 = ePos + sz.hw;
                    const du1 = Math.abs(cur.u - cand1);
                    const du2 = Math.abs(cur.u - cand2);
                    if (du1 <= snapPxImg && du1 < bestDU) {
                        bestDU = du1;
                        bestU = cand1;
                        snappedU = true;
                    }
                    if (du2 <= snapPxImg && du2 < bestDU) {
                        bestDU = du2;
                        bestU = cand2;
                        snappedU = true;
                    }
                }

                // --- SNAP lungo v ---
                let bestV = cur.v;
                let bestDV = snapPxImg + 1;
                let snappedV = false;

                for (const g of guidesRef.current.vCenters) {
                    const dv = Math.abs(cur.v - g);
                    if (dv <= snapPxImg && dv < bestDV) {
                        bestDV = dv;
                        bestV = g;
                        snappedV = true;
                    }
                }
                for (const ePos of guidesRef.current.vEdges) {
                    const cand1 = ePos - sz.hh;
                    const cand2 = ePos + sz.hh;
                    const dv1 = Math.abs(cur.v - cand1);
                    const dv2 = Math.abs(cur.v - cand2);
                    if (dv1 <= snapPxImg && dv1 < bestDV) {
                        bestDV = dv1;
                        bestV = cand1;
                        snappedV = true;
                    }
                    if (dv2 <= snapPxImg && dv2 < bestDV) {
                        bestDV = dv2;
                        bestV = cand2;
                        snappedV = true;
                    }
                }

                // aggiorna hint lines
                if (snappedU) {
                    const a = fromUV(bestU, uvBounds.minV);
                    const b = fromUV(bestU, uvBounds.maxV);
                    setHintU([a.x, a.y, b.x, b.y]);
                } else {
                    setHintU(null);
                }
                if (snappedV) {
                    const a = fromUV(uvBounds.minU, bestV);
                    const b = fromUV(uvBounds.maxU, bestV);
                    setHintV([a.x, a.y, b.x, b.y]);
                } else {
                    setHintV(null);
                }

                const snapped = fromUV(bestU, bestV);
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
            buildGuides,
            project,
            fromUV,
            uvBounds,
            snapPxImg,
            clearHints,
        ]
    );

    // cleanup a smontaggio
    React.useEffect(() => {
        return () => {
            try {
                stageRef.current?.off('.paneldrag');
            } catch { }
        };
    }, []);

    return {
        startDrag,     // (panelId, evt) => void
        hintU, hintV,  // linee guida (points x1,y1,x2,y2) oppure null
    };
}
