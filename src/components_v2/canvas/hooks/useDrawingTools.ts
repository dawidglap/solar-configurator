// src/components_v2/canvas/hooks/useDrawingTools.ts
'use client';

import * as React from 'react';
import type { Pt } from '../../canvas/geom';
import { rectFrom3WithAz } from '../../canvas/geom';
import { snapParallelPerp, isNear } from '../utils/snap';

// ➕ includiamo 'draw-reserved' nel tipo Tool
type Tool = 'select' | 'draw-roof' | 'draw-rect' | 'draw-reserved' | string;

type Layer = { id: string; name: string; points: Pt[] };

// Tipo minimo che l’hook richiede per aggiungere un tetto
type RoofAreaLike = {
    id: string;
    name: string;
    points: Pt[];
    azimuthDeg?: number;
    source?: string;
};

type SnapOptions = {
    tolDeg?: number;       // tolleranza in gradi per snap // default 12
    closeRadius?: number;  // raggio px per chiusura magnete // default 12
};

export function useDrawingTools<T extends RoofAreaLike>(args: {
    tool: Tool;
    layers: Layer[];
    addRoof: (r: T) => void;
    select: (id?: string) => void;
    toImgCoords: (stageX: number, stageY: number) => Pt;
    onZoneCommit?: (poly4: Pt[]) => void;
    // ⬇️ NEW opzionale
    snap?: SnapOptions;
}) {
    const { tool, layers, addRoof, select, toImgCoords, onZoneCommit, snap } = args;

    // default snap options
    const SNAP_TOL_DEG = snap?.tolDeg ?? 12;
    const CLOSE_RADIUS = snap?.closeRadius ?? 12;

    // stato locale di disegno
    const [drawingPoly, setDrawingPoly] = React.useState<Pt[] | null>(null);
    const [rectDraft, setRectDraft] = React.useState<Pt[] | null>(null); // [A,B] poi C al commit
    const [mouseImg, setMouseImg] = React.useState<Pt | null>(null);

    // cooldown per evitare doppio-commit in reserved
    const lastReservedCommitTs = React.useRef(0);
    const RESERVED_COOLDOWN_MS = 150;

    const onStageMouseMove = React.useCallback((e: any) => {
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        setMouseImg(toImgCoords(pos.x, pos.y));
    }, [toImgCoords]);

    const finishPolygon = React.useCallback((pts: Pt[]) => {
        if (pts.length < 3) { setDrawingPoly(null); return; }
        const id = 'roof_' + Date.now().toString(36);
        const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
        addRoof({ id, name, points: pts } as T);
        select(id);
        setDrawingPoly(null);
    }, [layers, addRoof, select]);

    // CLICK handler unico
    const onStageClick = React.useCallback((e: any) => {
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        const p = toImgCoords(pos.x, pos.y);

        // ── Poligono tetto libero (con SNAP al click)
        if (tool === 'draw-roof') {
            // primo punto
            if (!drawingPoly || drawingPoly.length === 0) {
                setDrawingPoly([p]);
                return;
            }

            const pts = drawingPoly;
            const last = pts[pts.length - 1];
            const prev = pts.length >= 2 ? pts[pts.length - 2] : undefined;
            const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

            // chiusura magnetica sul primo punto
            if (pts.length >= 3 && isNear(p, pts[0], CLOSE_RADIUS)) {
                // chiudi e salva
                finishPolygon(pts);
                return;
            }

            // snap parallelo/perpendicolare rispetto all'ultimo segmento
            const { pt } = snapParallelPerp(last, p, refDir, SNAP_TOL_DEG);
            setDrawingPoly([...pts, pt]);
            return;
        }

        // ── Rettangolo tetto da 3 click
        if (tool === 'draw-rect') {
            if (!rectDraft || rectDraft.length === 0) {
                setRectDraft([p]); // A
                return;
            }
            if (rectDraft.length === 1) {
                setRectDraft([rectDraft[0], p]); // A,B
                return;
            }
            // commit col terzo click
            const { poly, azimuthDeg } = rectFrom3WithAz(rectDraft[0], rectDraft[1], p);
            const id = 'roof_' + Date.now().toString(36);
            const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
            addRoof({ id, name, points: poly, azimuthDeg, source: 'manual' } as T);
            select(id);
            setRectDraft(null);
            return;
        }

        // ── ZONA VIETATA da 3 click (parallelogramma)
        if (tool === 'draw-reserved') {
            if (Date.now() - lastReservedCommitTs.current < RESERVED_COOLDOWN_MS) {
                return;
            }
            if (!rectDraft || rectDraft.length === 0) {
                setRectDraft([p]); // A
                return;
            }
            if (rectDraft.length === 1) {
                setRectDraft([rectDraft[0], p]); // A,B
                return;
            }
            // terzo click → commit zona
            const { poly } = rectFrom3WithAz(rectDraft[0], rectDraft[1], p);
            onZoneCommit?.(poly);
            setRectDraft(null);
            lastReservedCommitTs.current = Date.now();
            return;
        }

        // ── select: click vuoto deseleziona
        if (e.target === e.target.getStage()) select(undefined);
    }, [
        tool,
        toImgCoords,
        drawingPoly,
        rectDraft,
        layers,
        addRoof,
        select,
        onZoneCommit,
        finishPolygon,
        CLOSE_RADIUS,
        SNAP_TOL_DEG
    ]);

    // DOPPIO click → solo poligono tetto (chiudi se possibile)
    const onStageDblClick = React.useCallback(() => {
        if (tool !== 'draw-roof') return;
        if (drawingPoly && drawingPoly.length >= 3) {
            finishPolygon(drawingPoly);
        } else {
            setDrawingPoly(null);
        }
    }, [tool, drawingPoly, finishPolygon]);

    // ESC / ENTER
    React.useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            if (tool === 'draw-roof') {
                if (ev.key === 'Escape') setDrawingPoly(null);
                if (ev.key === 'Enter' && drawingPoly && drawingPoly.length >= 3) finishPolygon(drawingPoly);
            }
            // ESC chiude anche i draft di rect e reserved
            if (tool === 'draw-rect' || tool === 'draw-reserved') {
                if (ev.key === 'Escape') setRectDraft(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tool, drawingPoly, finishPolygon]);

    return {
        drawingPoly,
        rectDraft,
        mouseImg,
        onStageMouseMove,
        onStageClick,
        onStageDblClick,
    };
}
