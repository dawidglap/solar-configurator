// src/components_v2/state/slices/layersSlice.ts
import type { StateCreator } from 'zustand';
import type { RoofArea } from '@/types/planner';
import {
    clearSurfacePlanningOnRoofs,
    getRoofSurfacePlanning,
    setCommittedSurfacePlanningOnRoofs,
    type SurfacePlanningResolution,
    type SurfacePlanningV1,
} from '@/lib/planning-core/advanced/surfacePlanning';

export type LayersSlice = {
    layers: RoofArea[];
    addRoof: (r: RoofArea) => void;
    updateRoof: (id: string, patch: Partial<RoofArea>) => void;
    getSurfacePlanning: (roofId: string) => SurfacePlanningResolution;
    setCommittedSurfacePlanning: (roofId: string, config: SurfacePlanningV1) => void;
    clearSurfacePlanning: (roofId: string) => void;

    // teniamo entrambi i nomi: quello “vecchio” e quello nuovo
    deleteLayer: (id: string) => void; // legacy
    removeRoof: (id: string) => void;  // preferito

    selectedId?: string;
    select: (id?: string) => void;
};

export const createLayersSlice: StateCreator<LayersSlice, [], [], LayersSlice> = (set, get) => ({
    layers: [],

    addRoof: (r) =>
        set((st) => ({ layers: [...st.layers, r], selectedId: r.id })),

    updateRoof: (id, patch) =>
        set((st) => ({
            layers: st.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

    getSurfacePlanning: (roofId) => getRoofSurfacePlanning(get().layers, roofId),

    setCommittedSurfacePlanning: (roofId, config) =>
        set((st) => ({
            layers: setCommittedSurfacePlanningOnRoofs(st.layers, roofId, config),
        })),

    clearSurfacePlanning: (roofId) =>
        set((st) => ({
            layers: clearSurfacePlanningOnRoofs(st.layers, roofId),
        })),

    deleteLayer: (id) =>
        set((st) => ({
            layers: st.layers.filter((l) => l.id !== id),
            selectedId: st.selectedId === id ? undefined : st.selectedId,
        })),

    // alias con la stessa logica di deleteLayer
    removeRoof: (id) =>
        set((st) => ({
            layers: st.layers.filter((l) => l.id !== id),
            selectedId: st.selectedId === id ? undefined : st.selectedId,
        })),

    selectedId: undefined,
    select: (id) => set({ selectedId: id }),
});
