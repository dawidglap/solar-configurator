import { useRef, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { usePlannerV2Store } from '../state/plannerV2Store';
import type { Pt } from '@/types/planner';

function rect3ToPoly4(p0: Pt, p1: Pt, p2: Pt): Pt[] {
    // stessa logica usata per il tetto: p3 = p2 + (p1 - p0)
    return [p0, p1, { x: p2.x + (p1.x - p0.x), y: p2.y + (p1.y - p0.y) }, p2];
}

export function useDrawZone(roofId?: string) {
    const addZone = usePlannerV2Store((s) => s.addZone);
    const drawing = useRef<Pt[]>([]);

    const start = useCallback((p: Pt) => { drawing.current = [p]; }, []);
    const update = useCallback((p: Pt) => {
        const arr = drawing.current;
        if (!arr.length) return;
        if (arr.length === 1) drawing.current = [arr[0], p];
        else drawing.current = [arr[0], arr[1], p];
    }, []);
    const cancel = useCallback(() => { drawing.current = []; }, []);

    const commit = useCallback(() => {
        const arr = drawing.current;
        if (arr.length < 3 || !roofId) { drawing.current = []; return; }
        const poly = rect3ToPoly4(arr[0], arr[1], arr[2]);
        addZone({ id: nanoid(), roofId, type: 'riservata', points: poly });
        drawing.current = [];
    }, [addZone, roofId]);

    const getDraft = useCallback(() => drawing.current, []);

    return { start, update, commit, cancel, getDraft };
}
