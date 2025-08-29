'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ───────────────────────────────────────────────────────────
// TIPI & COSTANTI (ora esterni)
// ───────────────────────────────────────────────────────────
import type {
    PlannerStep, Tool,
    DetectedRoof, RoofArea, Snapshot, View,
    PanelSpec, ModulesConfig, PanelInstance
} from '@/types/planner';
import { PANEL_CATALOG } from '../../constants/panels';

// (opzionale) re-export per backward compatibility
export type {
    PlannerStep, UIState, Tool, Pt,
    DetectedRoof, RoofArea, Snapshot, View,
    PanelSpec, ModulesConfig, PanelInstance
} from '@/types/planner';

// ───────────────────────────────────────────────────────────
// SLICES
// ───────────────────────────────────────────────────────────
import type { UISlice } from './slices/uiSlice';
import { createUiSlice } from './slices/uiSlice';

import type { PanelsSlice } from './slices/panelsSlice';
import { createPanelsSlice } from './slices/panelsSlice';

// ───────────────────────────────────────────────────────────
// STATO
// ───────────────────────────────────────────────────────────
type PlannerV2State = {
    step: PlannerStep;
    setStep: (s: PlannerStep) => void;

    snapshot: Snapshot;
    setSnapshot: (s: Partial<Snapshot>) => void;

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

    detectedRoofs: DetectedRoof[];
    setDetectedRoofs: (arr: DetectedRoof[]) => void;
    clearDetectedRoofs: () => void;

    selectedId?: string;
    select: (id?: string) => void;

    /** Catalogo + scelta corrente */
    catalogPanels: PanelSpec[];
    selectedPanelId: string;
    setSelectedPanel: (id: string) => void;
    getSelectedPanel: () => PanelSpec | undefined;

    /** Configurazione moduli (step modules) */
    modules: ModulesConfig;
    setModules: (patch: Partial<ModulesConfig>) => void;
} & UISlice & PanelsSlice;

export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get) => ({
            // ── Step
            step: 'building',
            setStep: (s) => set({ step: s }),

            // ── Snapshot (non persistito)
            snapshot: {},
            setSnapshot: (s) => set((st) => ({ snapshot: { ...st.snapshot, ...s } })),

            // ── Snapshot scale
            snapshotScale: 2,
            setSnapshotScale: (n) => set({ snapshotScale: n }),

            // ── View
            view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
            setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),

            // ── Tool
            tool: 'select',
            setTool: (t) => set({ tool: t }),

            // ── Roof layers
            layers: [],
            addRoof: (r) => set((st) => ({ layers: [...st.layers, r], selectedId: r.id })),
            updateRoof: (id, patch) =>
                set((st) => ({ layers: st.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
            deleteLayer: (id) =>
                set((st) => ({ layers: st.layers.filter((l) => l.id !== id), selectedId: undefined })),

            // ── Selezione
            selectedId: undefined,
            select: (id) => set({ selectedId: id }),

            // ── Detected roofs
            detectedRoofs: [],
            setDetectedRoofs: (arr) => set({ detectedRoofs: arr }),
            clearDetectedRoofs: () => set({ detectedRoofs: [] }),

            // ── Catalogo pannelli
            catalogPanels: PANEL_CATALOG,
            selectedPanelId: PANEL_CATALOG[0].id,
            setSelectedPanel: (id) => set({ selectedPanelId: id }),
            getSelectedPanel: () => {
                const { catalogPanels, selectedPanelId } = get();
                return catalogPanels.find((p) => p.id === selectedPanelId);
            },

            // ── Modules config (defaults)
            modules: {
                orientation: 'portrait',
                spacingM: 0.02,
                marginM: 0.30,
                showGrid: true,
                placingSingle: false,
            },
            setModules: (patch) =>
                set((s) => ({ modules: { ...s.modules, ...patch } })),

            // ── UI slice (estratta)
            ...createUiSlice(set, get),

            // ── Panels slice (estratta)
            ...createPanelsSlice(set, get),
        }),
        {
            name: 'planner-v2',
            version: 8, // bump se cambi schema persistito

            storage: createJSONStorage(() => localStorage),

            partialize: (s) => ({
                step: s.step,
                view: s.view,
                tool: s.tool,
                layers: s.layers,
                selectedId: s.selectedId,
                snapshotScale: s.snapshotScale,
                catalogPanels: s.catalogPanels,
                selectedPanelId: s.selectedPanelId,
                modules: s.modules,
                panels: s.panels, // <- arriva da PanelsSlice, continua ad essere persistito
                // NOTA: s.ui non viene persistito (come prima)
            }),

            migrate: (persisted: any) => {
                if (!persisted) return persisted;

                // safety: rimuoviamo vecchio snapshot persistito se presente
                delete persisted?.snapshot;

                // snapshotScale guard
                if (![1, 2, 3].includes(persisted.snapshotScale)) {
                    persisted.snapshotScale = 2;
                }

                // catalog defaults
                if (!persisted.catalogPanels) persisted.catalogPanels = PANEL_CATALOG;
                if (!persisted.selectedPanelId) persisted.selectedPanelId = PANEL_CATALOG[0].id;

                // ensure view.fitScale
                if (!persisted.view) persisted.view = { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 };
                if (typeof persisted.view.fitScale !== 'number') {
                    persisted.view.fitScale = 1;
                }

                // ensure modules slice
                if (!persisted.modules) {
                    persisted.modules = {
                        orientation: 'portrait',
                        spacingM: 0.02,
                        marginM: 0.30,
                        showGrid: true,
                        placingSingle: false,
                    };
                }

                // ensure panels list + retrofill panelId
                if (!Array.isArray(persisted.panels)) {
                    persisted.panels = [];
                } else {
                    const fallbackPanelId =
                        (persisted.selectedPanelId as string) ||
                        PANEL_CATALOG[0].id;
                    persisted.panels = persisted.panels.map((p: any) => ({
                        ...p,
                        panelId: p.panelId ?? fallbackPanelId,
                    }));
                }

                return persisted;
            },
        }
    )
);

// Dev helper (facoltativo): test rapido da console
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    // @ts-expect-error debug helper
    window.plannerStore = usePlannerV2Store;
}
