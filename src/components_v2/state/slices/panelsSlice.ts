// src/components_v2/state/slices/panelsSlice.ts
import type { StateCreator } from 'zustand';
import type { PanelInstance } from '@/types/planner';

type PatchMap = Record<string, Partial<PanelInstance>>;
type PatchFn = (p: PanelInstance) => Partial<PanelInstance> | undefined | void;

export type PanelsSlice = {
    /** Istanze di pannelli */
    panels: PanelInstance[];

    /** ─ Selezione multipla (Step 1) ─ */
    selectedPanelIds: string[];
    setSelectedPanels: (ids: string[]) => void;
    togglePanelSelection: (id: string) => void;
    clearPanelSelection: () => void;

    /** ─ Operazioni base ─ */
    addPanels: (items: PanelInstance[]) => void;
    addPanelsForRoof: (roofId: string, items: PanelInstance[]) => void;
    clearPanelsForRoof: (roofId: string) => void;
    getPanelsForRoof: (roofId: string) => PanelInstance[];
    updatePanel: (id: string, patch: Partial<PanelInstance>) => void;
    deletePanel: (id: string) => void;
    duplicatePanel: (id: string, offsetPx?: number) => string | undefined;

    /** ─ Operazioni batch (Step 1) ─ */
    updatePanelsBulk: (patch: PatchMap | PatchFn) => void;
    deletePanelsBulk: (ids: string[]) => void;
};

export const createPanelsSlice: StateCreator<PanelsSlice, [], [], PanelsSlice> = (set, get) => ({
    panels: [],

    /** ─ Selezione multipla ─ */
    selectedPanelIds: [],
    setSelectedPanels: (ids) =>
        set(() => ({ selectedPanelIds: Array.from(new Set(ids)) })),
    togglePanelSelection: (id) =>
        set((s) => {
            const next = new Set(s.selectedPanelIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return { selectedPanelIds: [...next] };
        }),
    clearPanelSelection: () => set(() => ({ selectedPanelIds: [] })),

    /** ─ Operazioni base ─ */
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
        set((s) => {
            const panels = s.panels.filter((p) => p.id !== id);
            const selectedPanelIds = s.selectedPanelIds.filter((pid) => pid !== id);
            return { panels, selectedPanelIds };
        }),

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

    /** ─ Operazioni batch ─ */
    updatePanelsBulk: (patch) =>
        set((s) => ({
            panels: s.panels.map((p) => {
                const delta = typeof patch === 'function' ? (patch as PatchFn)(p) : (patch as PatchMap)[p.id];
                return delta ? { ...p, ...delta } : p;
            }),
        })),

    deletePanelsBulk: (ids) =>
        set((s) => {
            const idSet = new Set(ids);
            return {
                panels: s.panels.filter((p) => !idSet.has(p.id)),
                selectedPanelIds: s.selectedPanelIds.filter((id) => !idSet.has(id)),
            };
        }),
});
