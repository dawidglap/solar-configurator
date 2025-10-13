// src/components_v2/canvas/hooks/useDrawingTools.ts
'use client';

import * as React from 'react';
import type { Pt } from '../../canvas/geom';
import { rectFrom3WithAz } from '../../canvas/geom';
import { snapParallelPerp, isNear } from '../utils/snap';
// undo/redo globale (resta per le azioni “committed”)
import { history } from '../../state/history';

// Tool supportati
type Tool = 'select' | 'draw-roof' | 'draw-rect' | 'draw-reserved' | string;

type Layer = { id: string; name: string; points: Pt[] };

// Tipo minimo per aggiungere un tetto
type RoofAreaLike = {
    id: string;
    name: string;
    points: Pt[];
    azimuthDeg?: number;
    source?: string;
};

type SnapOptions = {
    tolDeg?: number;      // tolleranza in gradi per snap (default 12)
    closeRadius?: number; // raggio px per chiusura magnete (default 12)
};

export function useDrawingTools<T extends RoofAreaLike>(args: {
    tool: Tool;
    layers: Layer[];
    addRoof: (r: T) => void;
    select: (id?: string) => void;
    toImgCoords: (stageX: number, stageY: number) => Pt;
    onZoneCommit?: (poly4: Pt[]) => void; // per Hindernis
    snap?: SnapOptions;
    // per tornare allo strumento di selezione al commit
    setTool: (t: Tool) => void;
}) {
    const {
        tool, layers, addRoof, select, toImgCoords,
        onZoneCommit, snap, setTool
    } = args;

    // opzioni snap
    const SNAP_TOL_DEG = snap?.tolDeg ?? 12;
    const CLOSE_RADIUS = snap?.closeRadius ?? 12;

    // stato locale di disegno
    const [drawingPoly, setDrawingPoly] = React.useState<Pt[] | null>(null);
    const [rectDraft, setRectDraft] = React.useState<Pt[] | null>(null); // [A,B] poi C al commit
    const [mouseImg, setMouseImg] = React.useState<Pt | null>(null);

    // ——— stack redo locali (solo durante il disegno) ———
    const polyRedoRef = React.useRef<Pt[]>([]);
    const rectRedoRef = React.useRef<Pt[]>([]);

    // refs per leggere sempre lo stato corrente dentro keydown
    const toolRef = React.useRef(tool);
    const polyRef = React.useRef(drawingPoly);
    const rectRef = React.useRef(rectDraft);

    React.useEffect(() => { toolRef.current = tool; }, [tool]);
    React.useEffect(() => { polyRef.current = drawingPoly; }, [drawingPoly]);
    React.useEffect(() => { rectRef.current = rectDraft; }, [rectDraft]);

    // evita doppio-commit su draw-reserved (click + dblclick ravvicinati)
    const lastReservedCommitTs = React.useRef(0);
    const RESERVED_COOLDOWN_MS = 150;

    const onStageMouseMove = React.useCallback((e: any) => {
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        setMouseImg(toImgCoords(pos.x, pos.y));
    }, [toImgCoords]);

    // —— helper: aggiunge un punto al draft, pulendo il redo locale
    const addDraftPoint = React.useCallback((pt: Pt) => {
        const t = toolRef.current;
        if (t === 'draw-roof' || t === 'draw-reserved') {
            polyRedoRef.current = [];
            const cur = polyRef.current || [];
            setDrawingPoly([...cur, pt]);
        } else if (t === 'draw-rect') {
            rectRedoRef.current = [];
            const cur = rectRef.current || [];
            setRectDraft([...cur, pt]);
        }
    }, []);

    // —— helper: undo/redo locali (solo mentre si disegna)
    const popLastPoint = React.useCallback((): boolean => {
        const t = toolRef.current;
        if (t === 'draw-roof' || t === 'draw-reserved') {
            const cur = polyRef.current || [];
            if (cur.length > 0) {
                polyRedoRef.current.push(cur[cur.length - 1]); // salva per redo
                const next = cur.slice(0, -1);
                setDrawingPoly(next.length ? next : null);
                return true;
            }
        } else if (t === 'draw-rect') {
            const cur = rectRef.current || [];
            if (cur.length > 0) {
                rectRedoRef.current.push(cur[cur.length - 1]);
                const next = cur.slice(0, -1);
                setRectDraft(next.length ? next : null);
                return true;
            }
        }
        return false;
    }, []);

    const pushRedoPoint = React.useCallback((): boolean => {
        const t = toolRef.current;
        if (t === 'draw-roof' || t === 'draw-reserved') {
            const redo = polyRedoRef.current;
            if (redo.length > 0) {
                const last = redo.pop()!;
                const cur = polyRef.current || [];
                setDrawingPoly([...cur, last]);
                return true;
            }
        } else if (t === 'draw-rect') {
            const redo = rectRedoRef.current;
            if (redo.length > 0) {
                const last = redo.pop()!;
                const cur = rectRef.current || [];
                setRectDraft([...cur, last]);
                return true;
            }
        }
        return false;
    }, []);

    // —— commit tetto (poligono libero)
    const finishPolygon = React.useCallback((pts: Pt[]) => {
        if (pts.length < 3) { setDrawingPoly(null); polyRedoRef.current = []; return; }
        const id = 'roof_' + Date.now().toString(36);
        const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;

        history.push('add roof (free)'); // snapshot PRIMA

        addRoof({ id, name, points: pts } as T);
        select(id);
        setDrawingPoly(null);
        polyRedoRef.current = [];
        setTool('select'); // torna allo strumento di selezione
    }, [layers, addRoof, select, setTool]);

    // —— commit hindernis (poligono libero)
    const finishZone = React.useCallback((pts: Pt[]) => {
        if (pts.length < 3) { setDrawingPoly(null); polyRedoRef.current = []; return; }
        const now = Date.now();
        if (now - lastReservedCommitTs.current < RESERVED_COOLDOWN_MS) return;
        lastReservedCommitTs.current = now;

        history.push('add reserved zone'); // snapshot PRIMA

        onZoneCommit?.(pts);
        setDrawingPoly(null);
        polyRedoRef.current = [];
        select(undefined);  // svuota selezione attiva
        setTool('select');  // torna alla selezione
    }, [onZoneCommit, select, setTool]);

    // —— CLICK handler unico
    const onStageClick = React.useCallback((e: any) => {
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        const p = toImgCoords(pos.x, pos.y);

        // ── Poligono tetto libero (con SNAP al click)
        if (tool === 'draw-roof') {
            if (!drawingPoly || drawingPoly.length === 0) {
                setDrawingPoly([p]);
                polyRedoRef.current = [];
                return;
            }

            const pts = drawingPoly;
            const last = pts[pts.length - 1];
            const prev = pts.length >= 2 ? pts[pts.length - 2] : undefined;
            const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

            // chiusura magnetica sul primo punto
            if (pts.length >= 3 && isNear(p, pts[0], CLOSE_RADIUS)) {
                finishPolygon(pts);
                return;
            }

            const { pt } = snapParallelPerp(last, p, refDir, SNAP_TOL_DEG);
            addDraftPoint(pt); // pulisce redo locale
            return;
        }

        // ── Rettangolo tetto da 3 click
        if (tool === 'draw-rect') {
            if (!rectDraft || rectDraft.length === 0) {
                setRectDraft([p]); rectRedoRef.current = []; return; // A
            }
            if (rectDraft.length === 1) {
                setRectDraft([rectDraft[0], p]); rectRedoRef.current = []; return; // A,B
            }
            // commit col terzo click
            const { poly, azimuthDeg } = rectFrom3WithAz(rectDraft[0], rectDraft[1], p);
            const id = 'roof_' + Date.now().toString(36);
            const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;

            history.push('add roof (rect)'); // snapshot PRIMA

            addRoof({ id, name, points: poly, azimuthDeg, source: 'manual' } as T);
            select(id);
            setRectDraft(null);
            rectRedoRef.current = [];
            setTool('select');
            return;
        }

        // ── Hindernis: poligono libero (come draw-roof)
        if (tool === 'draw-reserved') {
            if (!drawingPoly || drawingPoly.length === 0) {
                setDrawingPoly([p]);
                polyRedoRef.current = [];
                return;
            }

            const pts = drawingPoly;
            const last = pts[pts.length - 1];
            const prev = pts.length >= 2 ? pts[pts.length - 2] : undefined;
            const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

            if (pts.length >= 3 && isNear(p, pts[0], CLOSE_RADIUS)) {
                finishZone(pts);
                return;
            }

            const { pt } = snapParallelPerp(last, p, refDir, SNAP_TOL_DEG);
            addDraftPoint(pt); // pulisce redo locale
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
        finishPolygon,
        finishZone,
        CLOSE_RADIUS,
        SNAP_TOL_DEG,
        addDraftPoint,
        setTool,
    ]);

    // —— DOPPIO click → chiusura poligono
    const onStageDblClick = React.useCallback(() => {
        if (!drawingPoly || drawingPoly.length < 3) return;

        if (tool === 'draw-roof') {
            finishPolygon(drawingPoly);
            return;
        }
        if (tool === 'draw-reserved') {
            finishZone(drawingPoly);
            return;
        }
    }, [tool, drawingPoly, finishPolygon, finishZone]);

    // —— Keybindings locali: Undo/Redo SOLO in modalità disegno
    // —— Keybindings locali: Undo/Redo SOLO in modalità disegno
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = toolRef.current;
            // se non sto disegnando, non intercetto
            if (t !== 'draw-roof' && t !== 'draw-reserved' && t !== 'draw-rect') return;

            const key = (e.key || '').toLowerCase();
            const ctrlOrMeta = e.ctrlKey || e.metaKey;
            const isUndo = ctrlOrMeta && key === 'z' && !e.shiftKey;
            const isRedo = (ctrlOrMeta && key === 'z' && e.shiftKey) || (ctrlOrMeta && key === 'y');

            // Undo locale: rimuovi ultimo punto del draft
            if (isUndo) {
                const handled = popLastPoint();
                if (handled) {
                    e.preventDefault();
                    // importantissimo: blocca la history globale
                    e.stopPropagation();
                    // @ts-expect-error: su alcuni browser esiste
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                }
                return;
            }

            // Redo locale
            if (isRedo) {
                const handled = pushRedoPoint();
                if (handled) {
                    e.preventDefault();
                    e.stopPropagation();
                    // @ts-expect-error
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                }
                return;
            }

            // ESC/ENTER come prima (quando sto disegnando)
            if ((t === 'draw-roof' || t === 'draw-reserved') && key === 'escape') {
                setDrawingPoly(null);
                polyRedoRef.current = [];
                e.preventDefault();
                e.stopPropagation();
                // @ts-expect-error
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            }
            if (t === 'draw-rect' && key === 'escape') {
                setRectDraft(null);
                rectRedoRef.current = [];
                e.preventDefault();
                e.stopPropagation();
                // @ts-expect-error
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            }
            if ((t === 'draw-roof' || t === 'draw-reserved') && key === 'enter' && polyRef.current && polyRef.current.length >= 3) {
                if (t === 'draw-roof') finishPolygon(polyRef.current);
                else finishZone(polyRef.current);
                e.preventDefault();
                e.stopPropagation();
                // @ts-expect-error
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            }
        };

        // capture:true così passiamo prima dei listener globali (history/ToolHotkeys)
        window.addEventListener('keydown', onKey, { capture: true });
        return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
    }, [popLastPoint, pushRedoPoint, finishPolygon, finishZone]);


    return {
        drawingPoly,
        rectDraft,
        mouseImg,
        onStageMouseMove,
        onStageClick,
        onStageDblClick,
    };
}
