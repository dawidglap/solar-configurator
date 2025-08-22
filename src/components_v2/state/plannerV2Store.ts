'use client';

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { produce } from 'immer';

export type PlannerStep = 'building' | 'modules' | 'strings' | 'parts';

type SnapshotMeta = {
    url?: string;
    width?: number;
    height?: number;
    metersPerPixel?: number; // set in step 2
};

export type PlannerV2State = {
    projectId: string;
    step: PlannerStep;
    snapshot: SnapshotMeta;
    selectedId?: string;
    // scaffolding per futuri dati
    areas: any[];
    exclusions: any[];
    modules: any[];

    // actions
    setStep: (s: PlannerStep) => void;
    setSnapshot: (m: Partial<SnapshotMeta>) => void;
};

export const usePlannerV2Store = create<PlannerV2State>((set) => ({
    projectId: nanoid(),
    step: 'building',
    snapshot: {},
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
}));
