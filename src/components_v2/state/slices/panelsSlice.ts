// src/components_v2/state/slices/panelsSlice.ts
import type { StateCreator } from 'zustand';
import type { PanelInstance } from '@/types/planner';

export type PanelsSlice = {
    /** Istanze di pannelli */
    panels: PanelInstance[];

    addPanels: (items: PanelInstance[]) => void;
    addPanelsForRoof: (roofId: string, items: PanelInstance[]) => void;
    clearPanelsForRoof: (roofId: string) => void;
    getPanelsForRoof: (roofId: string) => PanelInstance[];
    updatePanel: (id: string, patch: Partial<PanelInstance>) => void;
    deletePanel: (id: string) => void;
    duplicatePanel: (id: string, offsetPx?: number) => string | undefined;
};

export const createPanelsSlice: StateCreator<PanelsSlice, [], [], PanelsSlice> = (set, get) => ({
    panels: [],

    addPanels: (items) =>
        set((s) => ({ panels: [...s.panels, ...items] })),

    addPanelsForRoof: (roofId, items) =>
        set((s) => ({
            panels: [
                ...s.panels,
                ...items.map((p) => ({ ...p, roofId })), // coerenza forzata
            ],
        })),

    clearPanelsForRoof: (roofId) =>
        set((s) => ({ panels: s.panels.filter((p) => p.roofId !== roofId) })),

    getPanelsForRoof: (roofId) => {
        const { panels } = get();
        return panels.filter((p) => p.roofId === roofId);
    },

    updatePanel: (id, patch) =>
        set((s) => ({ panels: s.panels.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

    deletePanel: (id) =>
        set((s) => ({ panels: s.panels.filter((p) => p.id !== id) })),

    duplicatePanel: (id, offsetPx = 18) => {
        const { panels } = get();
        const src = panels.find((p) => p.id === id);
        if (!src) return undefined;

        const rad = ((src.angleDeg ?? 0) * Math.PI) / 180;
        const dx = Math.cos(rad) * offsetPx;
        const dy = Math.sin(rad) * offsetPx;

        const newId = `${src.id}_copy_${Math.random().toString(36).slice(2, 7)}`;

        const clone: PanelInstance = {
            ...src,
            id: newId,
            cx: src.cx + dx,
            cy: src.cy + dy,
            locked: false,
        };

        set((s) => ({ panels: [...s.panels, clone] }));
        return newId;
    },
});
