'use client';

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { produce } from 'immer';

export type PlannerStep = 'building' | 'modules' | 'strings' | 'parts';

type SnapshotMeta = {
    url?: string;         // dataURL dello screenshot/immagine
    width?: number;       // dimensioni naturali dell'immagine
    height?: number;
    mppImage?: number;    // meters per *image* pixel (metri/px sull'immagine originale)
};

type Viewport = {
    scale: number;        // scala applicata per il fit nel canvas
    offsetX: number;      // (per ora 0; useremo in futuro per pan/zoom)
    offsetY: number;
};

export type PlannerV2State = {
    projectId: string;
    step: PlannerStep;
    snapshot: SnapshotMeta;
    view: Viewport;

    selectedId?: string;
    areas: any[];
    exclusions: any[];
    modules: any[];

    setStep: (s: PlannerStep) => void;
    setSnapshot: (m: Partial<SnapshotMeta>) => void;
    setView: (m: Partial<Viewport>) => void;
};

export const usePlannerV2Store = create<PlannerV2State>((set) => ({
    projectId: nanoid(),
    step: 'building',
    snapshot: {},
    view: { scale: 1, offsetX: 0, offsetY: 0 },

    selectedId: undefined,
    areas: [],
    exclusions: [],
    modules: [],

    setStep: (s) => set({ step: s }),
    setSnapshot: (m) =>
        set(
            produce<PlannerV2State>((draft) => {
                draft.snapshot = { ...draft.snapshot, ...m };
            })
        ),
    setView: (m) =>
        set(
            produce<PlannerV2State>((draft) => {
                draft.view = { ...draft.view, ...m };
            })
        ),
}));
