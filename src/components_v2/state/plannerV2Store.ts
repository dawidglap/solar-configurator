'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PlannerStep = 'building' | 'modules' | 'strings' | 'parts';
export type Tool = 'select' | 'draw-roof' | 'draw-reserved';

export type Pt = { x: number; y: number };

export type RoofArea = {
    id: string;
    name: string;
    points: Pt[];
    slopeX?: number;
    slopeY?: number;
};

type Snapshot = {
    url?: string;
    width?: number;
    height?: number;
    mppImage?: number;
};

type View = { scale: number; offsetX: number; offsetY: number };

type PlannerV2State = {
    step: PlannerStep;
    setStep: (s: PlannerStep) => void;

    snapshot: Snapshot;
    setSnapshot: (s: Partial<Snapshot>) => void;

    // ⬇️ nuovo: qualità dello snapshot (HiDPI)
    snapshotScale: 1 | 2 | 3;
    setSnapshotScale: (n: 1 | 2 | 3) => void;

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

export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get) => ({
            step: 'building',
            setStep: (s) => set({ step: s }),

            snapshot: {},
            setSnapshot: (s) => set((st) => ({ snapshot: { ...st.snapshot, ...s } })),

            // ⬇️ default 2× per una buona nitidezza
            snapshotScale: 2,
            setSnapshotScale: (n) => set({ snapshotScale: n }),

            view: { scale: 1, offsetX: 0, offsetY: 0 },
            setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),

            tool: 'select',
            setTool: (t) => set({ tool: t }),

            layers: [],
            addRoof: (r) => set((st) => ({ layers: [...st.layers, r], selectedId: r.id })),
            updateRoof: (id, patch) =>
                set((st) => ({ layers: st.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
            deleteLayer: (id) =>
                set((st) => ({ layers: st.layers.filter((l) => l.id !== id), selectedId: undefined })),

            selectedId: undefined,
            select: (id) => set({ selectedId: id }),
        }),
        {
            name: 'planner-v2',
            version: 3,
            storage: createJSONStorage(() => localStorage),
            // NON persistiamo lo snapshot (base64)
            partialize: (s) => ({
                step: s.step,
                view: s.view,
                tool: s.tool,
                layers: s.layers,
                selectedId: s.selectedId,
                snapshotScale: s.snapshotScale, // sì, questo è piccolo
            }),
            migrate: (persisted: any) => {
                if (!persisted) return persisted;
                delete persisted?.snapshot; // safety
                if (persisted.snapshotScale !== 1 && persisted.snapshotScale !== 2 && persisted.snapshotScale !== 3) {
                    persisted.snapshotScale = 2;
                }
                return persisted;
            },
        }
    )
);
