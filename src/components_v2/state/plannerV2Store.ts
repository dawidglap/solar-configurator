'use client';
import { create } from 'zustand';

export type Tool = 'select' | 'draw-roof' | 'draw-reserved';

export type Pt = { x: number; y: number };

export type RoofArea = {
    id: string;
    name: string;
    points: Pt[];               // in pixel canvas
    slopeX?: number;            // gradi (opzionale)
    slopeY?: number;            // gradi (opzionale)
};

type Snapshot = {
    url?: string;
    width?: number;
    height?: number;
    mppImage?: number;
};

type View = { scale: number; offsetX: number; offsetY: number };

type PlannerV2State = {
    snapshot: Snapshot;
    setSnapshot: (s: Partial<Snapshot>) => void;

    view: View;
    setView: (v: Partial<View>) => void;

    tool: Tool;
    setTool: (t: Tool) => void;

    layers: RoofArea[];
    addRoof: (r: RoofArea) => void;
    updateRoof: (id: string, patch: Partial<RoofArea>) => void;
    deleteLayer: (id: string) => void;

    selectedId?: string;
    select: (id?: string) => void;
};

export const usePlannerV2Store = create<PlannerV2State>((set) => ({
    snapshot: {},
    setSnapshot: (s) => set((st) => ({ snapshot: { ...st.snapshot, ...s } })),
    view: { scale: 1, offsetX: 0, offsetY: 0 },
    setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),
    tool: 'select',
    setTool: (t) => set({ tool: t }),
    layers: [],
    addRoof: (r) => set((st) => ({ layers: [...st.layers, r], selectedId: r.id })),
    updateRoof: (id, patch) =>
        set((st) => ({
            layers: st.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),
    deleteLayer: (id) =>
        set((st) => ({
            layers: st.layers.filter((l) => l.id !== id),
            selectedId: undefined,
        })),
    select: (id) => set({ selectedId: id }),
}));
