// src/components_v2/state/slices/uiSlice.ts
import type { StateCreator } from 'zustand';
import type { UIState } from '@/types/planner';

export type UISlice = {
    ui: UIState;
    setUI: (partial: Partial<UIState>) => void;
    toggleStepperOpen: () => void;
    toggleRightPanelOpen: () => void;
    toggleLeftPanelOpen: () => void;
    openSearch: () => void;
    closeSearch: () => void;
};

export const createUiSlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
    ui: {
        stepperOpen: true,
        rightPanelOpen: false,
        leftPanelOpen: false,
        searchOpen: false,
    },

    setUI: (partial) =>
        set((state) => ({ ui: { ...state.ui, ...partial } })),

    toggleStepperOpen: () =>
        set((state) => ({ ui: { ...state.ui, stepperOpen: !state.ui.stepperOpen } })),

    toggleRightPanelOpen: () =>
        set((state) => ({ ui: { ...state.ui, rightPanelOpen: !state.ui.rightPanelOpen } })),

    toggleLeftPanelOpen: () =>
        set((state) => ({ ui: { ...state.ui, leftPanelOpen: !state.ui.leftPanelOpen } })),

    openSearch: () =>
        set((state) => ({ ui: { ...state.ui, searchOpen: true } })),

    closeSearch: () =>
        set((state) => ({ ui: { ...state.ui, searchOpen: false } })),
});
