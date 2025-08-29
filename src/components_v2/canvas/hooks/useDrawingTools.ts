// src/components_v2/canvas/hooks/useDrawingTools.ts
'use client';

import * as React from 'react';
import type { Pt } from '../../canvas/geom';
import { rectFrom3WithAz, dist } from '../../canvas/geom';

type Tool = 'select' | 'draw-roof' | 'draw-rect' | string;

type Layer = { id: string; name: string; points: Pt[] };

// Tipo minimo che l’hook richiede per aggiungere un tetto
type RoofAreaLike = {
    id: string;
    name: string;
    points: Pt[];
    azimuthDeg?: number;
    source?: string;
};

export function useDrawingTools<T extends RoofAreaLike>(args: {
    tool: Tool;
    layers: Layer[];
    addRoof: (r: T) => void;
    select: (id?: string) => void;
    toImgCoords: (stageX: number, stageY: number) => Pt;
}) {
    const { tool, layers, addRoof, select, toImgCoords } = args;

    // stato locale di disegno
    const [drawingPoly, setDrawingPoly] = React.useState<Pt[] | null>(null);
    const [rectDraft, setRectDraft] = React.useState<Pt[] | null>(null); // [A,B], poi C al commit
    const [mouseImg, setMouseImg] = React.useState<Pt | null>(null);

    const onStageMouseMove = React.useCallback((e: any) => {
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        setMouseImg(toImgCoords(pos.x, pos.y));
    }, [toImgCoords]);

    const closeIfNearStart = React.useCallback((pts: Pt[], current: Pt) => {
        if (pts.length < 3) return false;
        const thr = 10; // px immagine
        return dist(pts[0], current) <= thr;
    }, []);

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

        if (tool === 'draw-roof') {
            if (!drawingPoly || drawingPoly.length === 0) {
                setDrawingPoly([p]);
                return;
            }
            if (closeIfNearStart(drawingPoly, p)) {
                const pts = drawingPoly;
                const id = 'roof_' + Date.now().toString(36);
                const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
                addRoof({ id, name, points: pts } as T);
                select(id);
                setDrawingPoly(null);
                return;
            }
            setDrawingPoly([...drawingPoly, p]);
            return;
        }

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

        // select: click vuoto deseleziona
        if (e.target === e.target.getStage()) select(undefined);
    }, [tool, toImgCoords, drawingPoly, rectDraft, layers, addRoof, select, closeIfNearStart]);

    // DOPPIO click → solo poligono
    const onStageDblClick = React.useCallback(() => {
        if (tool !== 'draw-roof') return;
        if (drawingPoly && drawingPoly.length >= 3) {
            const pts = drawingPoly;
            const id = 'roof_' + Date.now().toString(36);
            const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
            addRoof({ id, name, points: pts } as T);
            select(id);
            setDrawingPoly(null);
        } else {
            setDrawingPoly(null);
        }
    }, [tool, drawingPoly, layers, addRoof, select]);

    // ESC / ENTER
    React.useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            if (tool === 'draw-roof') {
                if (ev.key === 'Escape') setDrawingPoly(null);
                if (ev.key === 'Enter' && drawingPoly && drawingPoly.length >= 3) finishPolygon(drawingPoly);
            }
            if (tool === 'draw-rect') {
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
