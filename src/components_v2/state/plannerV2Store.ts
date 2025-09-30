'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// ⬇️ NEW
import { isToolAllowed, defaultToolFor } from './capabilities';
import { ALLOWED_TOOLS, DEFAULT_TOOL } from '../../constants/stepTools';

import { history } from './history';


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


// 👇 rotazione falde: stato di allineamento
type RoofAlign = {
    rotDeg: number;                  // gradi (−30..+30 consigliato)
    pivotPx?: { x: number; y: number }; // pivot opzionale in px immagine
};


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

    roofAlign: RoofAlign;
    setRoofRotDeg: (deg: number) => void;
    setRoofPivotPx: (p?: { x: number; y: number }) => void;
    resetRoofAlign: () => void;
} & UISlice & LayersSlice & PanelsSlice & ZonesSlice;

export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get, api) => ({
            // ── Step
            step: 'building',

            setStep: (s) =>
                set((st) => {
                    const allowed = ALLOWED_TOOLS[s];
                    const nextTool = allowed.includes(st.tool) ? st.tool : DEFAULT_TOOL[s];
                    return { step: s, tool: nextTool };
                }),

            // ── Snapshot (non persistito)
            snapshot: {},
            setSnapshot: (s) => set((st) => ({ snapshot: { ...st.snapshot, ...s } })),

            resetForNewAddress: (snap: Partial<Snapshot>) => {
                set((s) => ({
                    // aggiorna i metadati dell’immagine
                    snapshot: { ...s.snapshot, ...snap },

                    // reset navigazione/strumenti
                    view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
                    tool: 'select',
                    step: 'building',
                    roofAlign: { rotDeg: 0, pivotPx: undefined },

                    // pulizia selezioni
                    selectedId: undefined,
                    selectedZoneId: undefined,

                    // svuota progetto corrente
                    layers: [],
                    zones: [],
                    panels: [],
                    detectedRoofs: [],

                    // (opzionale) reset leggeri della griglia
                    modules: {
                        ...s.modules,
                        gridAngleDeg: 0,
                        gridPhaseX: 0,
                        gridPhaseY: 0,
                        coverageRatio: 1,
                    },
                }));
                // niente “undo” verso il progetto precedente
                history.clear();
            },


            // ── Snapshot scale
            snapshotScale: 2,
            setSnapshotScale: (n) => set({ snapshotScale: n }),

            // ── View
            view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
            setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),

            // ── Tool
            tool: 'select',
            setTool: (t) =>
                set((st) => {
                    // Se il tool non è permesso nello step attuale, non attivarlo:
                    if (!isToolAllowed(st.step, t)) {
                        // fallback: mantieni l'attuale se valido, altrimenti metti il default
                        const safe = isToolAllowed(st.step, st.tool) ? st.tool : defaultToolFor(st.step);
                        return { tool: safe };
                    }
                    return { tool: t };
                }),

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
                coverageRatio: 1,
            },

            setModules: (patch) =>
                set((s) => ({ modules: { ...s.modules, ...patch } })),

            // ── Sonnendach rilevati
            detectedRoofs: [],
            setDetectedRoofs: (arr) => set({ detectedRoofs: arr }),
            clearDetectedRoofs: () => set({ detectedRoofs: [] }),

            // ── Roof alignment (rotazione falde)
            roofAlign: { rotDeg: 0, pivotPx: undefined },

            setRoofRotDeg: (deg) =>
                set((s) => ({
                    roofAlign: {
                        ...s.roofAlign,
                        // clamp leggero per evitare rotazioni estreme
                        rotDeg: Math.max(-30, Math.min(30, deg)),
                    },
                })),

            setRoofPivotPx: (p) =>
                set((s) => ({ roofAlign: { ...s.roofAlign, pivotPx: p } })),

            resetRoofAlign: () =>
                set(() => ({ roofAlign: { rotDeg: 0, pivotPx: undefined } })),


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
            version: 10,

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
                roofAlign: s.roofAlign,

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

                if (typeof persisted.modules.coverageRatio !== 'number') {
                    persisted.modules.coverageRatio = 1;
                }

                // ensure roofAlign
                if (!persisted.roofAlign) {
                    persisted.roofAlign = { rotDeg: 0, pivotPx: undefined };
                } else {
                    if (typeof persisted.roofAlign.rotDeg !== 'number') persisted.roofAlign.rotDeg = 0;
                    const p = persisted.roofAlign.pivotPx;
                    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
                        persisted.roofAlign.pivotPx = undefined;
                    }
                }



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
