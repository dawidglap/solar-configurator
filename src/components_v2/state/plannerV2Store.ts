'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ───────────────────────────────────────────────────────────
// TIPI & COSTANTI
// ───────────────────────────────────────────────────────────
import type {
    PlannerStep, Tool,
    DetectedRoof, Snapshot, View,
    PanelSpec, ModulesConfig
} from '@/types/planner';
import { PANEL_CATALOG } from '../../constants/panels';

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

import type { LayersSlice } from './slices/layersSlice';
import { createLayersSlice } from './slices/layersSlice';

import type { ZonesSlice } from './slices/zonesSlice';
import { createZonesSlice } from './slices/zonesSlice';




// ───────────────────────────────────────────────────────────
// STATO
// ───────────────────────────────────────────────────────────
type PlannerV2State = {
    // step & snapshot
    step: PlannerStep;
    setStep: (s: PlannerStep) => void;
    snapshot: Snapshot;
    setSnapshot: (s: Partial<Snapshot>) => void;

    // view & tools
    snapshotScale: 1 | 2 | 3;
    setSnapshotScale: (n: 1 | 2 | 3) => void;
    view: View;
    setView: (v: Partial<View>) => void;
    tool: Tool;
    setTool: (t: Tool) => void;

    // pannelli (catalogo + config)
    catalogPanels: PanelSpec[];
    selectedPanelId: string;
    setSelectedPanel: (id: string) => void;
    getSelectedPanel: () => PanelSpec | undefined;
    modules: ModulesConfig;
    setModules: (patch: Partial<ModulesConfig>) => void;

    // Sonnendach rilevati
    detectedRoofs: DetectedRoof[];
    setDetectedRoofs: (arr: DetectedRoof[]) => void;
    clearDetectedRoofs: () => void;
} & UISlice & LayersSlice & PanelsSlice & ZonesSlice;

export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get, api) => ({
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
                marginM: 0.20,
                showGrid: true,
                placingSingle: false,
                gridAngleDeg: 0,
                gridPhaseX: 0,             // 👈 nuovo
                gridPhaseY: 0,             // 👈 nuovo
                gridAnchorX: 'start',      // 👈 nuovo: 'start' | 'center' | 'end'
                gridAnchorY: 'start',      // 👈 nuovo
            },

            setModules: (patch) =>
                set((s) => ({ modules: { ...s.modules, ...patch } })),

            // ── Sonnendach rilevati
            detectedRoofs: [],
            setDetectedRoofs: (arr) => set({ detectedRoofs: arr }),
            clearDetectedRoofs: () => set({ detectedRoofs: [] }),

            // ── UI slice
            ...createUiSlice(set, get, api),

            // ── Layers slice
            ...createLayersSlice(set, get, api),

            // ── Panels slice
            ...createPanelsSlice(set, get, api),
            // ── Zones slice
            ...createZonesSlice(set, get, api),

        }),
        {
            name: 'planner-v2',
            version: 8,

            storage: createJSONStorage(() => localStorage),

            partialize: (s) => ({
                step: s.step,
                view: s.view,
                tool: s.tool,
                layers: s.layers,          // <- LayersSlice
                selectedId: s.selectedId,  // <- LayersSlice
                snapshotScale: s.snapshotScale,
                catalogPanels: s.catalogPanels,
                selectedPanelId: s.selectedPanelId,
                modules: s.modules,
                panels: s.panels,          // <- PanelsSlice
                // 👇👇👇 aggiungi questi due
                zones: s.zones,            // <- ZonesSlice
                selectedZoneId: s.selectedZoneId, // <- ZonesSlice
                // s.ui non persistito
            }),


            migrate: (persisted: any) => {

                // ensure zones slice
                if (!Array.isArray(persisted.zones)) {
                    persisted.zones = [];
                }
                if (persisted.selectedZoneId) {
                    const exists = persisted.zones.some((z: any) => z.id === persisted.selectedZoneId);
                    if (!exists) persisted.selectedZoneId = undefined;
                }

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
                        marginM: 0.20,
                        showGrid: true,
                        placingSingle: false,
                    };
                }
                if (typeof persisted.modules.gridAngleDeg !== 'number') {
                    persisted.modules.gridAngleDeg = 0;
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

                if (typeof persisted.modules.gridPhaseX !== 'number') persisted.modules.gridPhaseX = 0;
                if (typeof persisted.modules.gridPhaseY !== 'number') persisted.modules.gridPhaseY = 0;
                if (!['start', 'center', 'end'].includes(persisted.modules.gridAnchorX)) persisted.modules.gridAnchorX = 'start';
                if (!['start', 'center', 'end'].includes(persisted.modules.gridAnchorY)) persisted.modules.gridAnchorY = 'start';


                return persisted;
            },
        }
    )
);

// Dev helper
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    // @ts-expect-error debug helper
    window.plannerStore = usePlannerV2Store;
}
