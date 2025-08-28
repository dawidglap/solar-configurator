'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ───────────────────────────────────────────────────────────
// TIPI
// ───────────────────────────────────────────────────────────
export type PlannerStep = 'building' | 'modules' | 'strings' | 'parts';

type UIState = {
    stepperOpen: boolean;
    rightPanelOpen: boolean;
    leftPanelOpen: boolean;
    searchOpen: boolean;
};




export type Tool = 'select' | 'draw-roof' | 'draw-reserved' | 'draw-rect';

export type Pt = { x: number; y: number };

export type DetectedRoof = {
    id: string;
    points: Pt[];                 // in px immagine
    tiltDeg?: number;
    azimuthDeg?: number;
    source: 'sonnendach';
};

export type RoofArea = {
    id: string;
    name: string;
    points: Pt[];
    slopeX?: number;
    slopeY?: number;

    // orientamento/inclinazione “fisici”
    tiltDeg?: number;        // Neigung (°)
    azimuthDeg?: number;     // Ausrichtung (°, 0=N, 90=E, 180=S, 270=W)
    source?: 'manual' | 'sonnendach';

    // pronto per “zone vietate” (buchi) — opzionale
    exclusions?: Pt[][];
};

type Snapshot = {
    url?: string;
    width?: number;
    height?: number;
    mppImage?: number;

    // info per georeferenziare lo snapshot
    center?: { lat: number; lon: number };   // WGS84
    zoom?: number;                           // WMTS/3857 zoom
    bbox3857?: { minX: number; minY: number; maxX: number; maxY: number }; // in metri
};

export type View = {
    scale: number;
    offsetX: number;
    offsetY: number;
    fitScale: number; // min zoom (cover)
};

/** Catalogo pannelli (hard-coded ora, estendibile / brand-specific in futuro) */
export type PanelSpec = {
    id: string;
    brand: string;
    model: string;
    wp: number;      // potenza (W)
    widthM: number;  // lato corto in metri
    heightM: number; // lato lungo in metri
};

const PANEL_CATALOG: PanelSpec[] = [
    { id: 'GEN54-410', brand: 'Generic', model: 'M10 54c', wp: 410, widthM: 1.134, heightM: 1.722 },
    { id: 'GEN54-425', brand: 'Generic', model: 'M10 54c', wp: 425, widthM: 1.134, heightM: 1.762 },
    { id: 'GEN72-550', brand: 'Generic', model: 'M10 72c', wp: 550, widthM: 1.134, heightM: 2.279 },
];

// ── Configurazione moduli per lo step “modules”
export type ModulesConfig = {
    orientation: 'portrait' | 'landscape';
    spacingM: number;      // distanza fra moduli (m)
    marginM: number;       // bordo falda (m)
    showGrid: boolean;
    placingSingle: boolean;
};

// ── Istanze di pannello materializzate
export type PanelInstance = {
    id: string;
    roofId: string;
    cx: number;          // centro in px immagine
    cy: number;          // centro in px immagine
    wPx: number;         // larghezza in px immagine
    hPx: number;         // altezza in px immagine
    angleDeg: number;    // rotazione assoluta (°)
    orientation: 'portrait' | 'landscape';
    panelId: string;     // riferimento al catalogo
    locked?: boolean;
};

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

    /** Istanze di pannelli */
    panels: PanelInstance[];
    addPanels: (items: PanelInstance[]) => void;
    addPanelsForRoof: (roofId: string, items: PanelInstance[]) => void;   // ⬅️ nuovo helper
    clearPanelsForRoof: (roofId: string) => void;
    getPanelsForRoof: (roofId: string) => PanelInstance[];                 // ⬅️ selector comodo
    updatePanel: (id: string, patch: Partial<PanelInstance>) => void;
    deletePanel: (id: string) => void;
    duplicatePanel: (id: string, offsetPx?: number) => string | undefined;


    /** UI slice */
    ui: UIState;
    setUI: (partial: Partial<UIState>) => void;
    toggleStepperOpen: () => void;
    toggleRightPanelOpen: () => void;
    toggleLeftPanelOpen: () => void;
    openSearch: () => void;
    closeSearch: () => void;


};

export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get) => ({
            step: 'building',
            setStep: (s) => set({ step: s }),

            snapshot: {},
            setSnapshot: (s) => set((st) => ({ snapshot: { ...st.snapshot, ...s } })),

            snapshotScale: 2,
            setSnapshotScale: (n) => set({ snapshotScale: n }),

            view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
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

            detectedRoofs: [],
            setDetectedRoofs: (arr) => set({ detectedRoofs: arr }),
            clearDetectedRoofs: () => set({ detectedRoofs: [] }),

            /** Catalogo pannelli */
            catalogPanels: PANEL_CATALOG,
            selectedPanelId: PANEL_CATALOG[0].id,
            setSelectedPanel: (id) => set({ selectedPanelId: id }),
            getSelectedPanel: () => {
                const { catalogPanels, selectedPanelId } = get();
                return catalogPanels.find((p) => p.id === selectedPanelId);
            },

            /** Modules config (defaults) */
            modules: {
                orientation: 'portrait',
                spacingM: 0.02,
                marginM: 0.30,
                showGrid: true,
                placingSingle: false,
            },
            setModules: (patch) =>
                set((s) => ({ modules: { ...s.modules, ...patch } })),

            /** Panel instances */
            panels: [],
            addPanels: (items) =>
                set((s) => ({ panels: [...s.panels, ...items] })),

            addPanelsForRoof: (roofId, items) =>
                set((s) => ({
                    panels: [
                        ...s.panels,
                        ...items.map((p) => ({ ...p, roofId })), // forziamo coerenza
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
                set((s) => ({ panels: s.panels.filter((p) => p.id !== id) })),

            duplicatePanel: (id, offsetPx = 18) => {
                const { panels } = get();
                const src = panels.find((p) => p.id === id);
                if (!src) return undefined;

                const rad = ((src.angleDeg ?? 0) * Math.PI) / 180;
                const dx = Math.cos(rad) * offsetPx;
                const dy = Math.sin(rad) * offsetPx;

                const newId = `${src.id}_copy_${Math.random().toString(36).slice(2, 7)}`;

                const clone = {
                    ...src,
                    id: newId,
                    cx: src.cx + dx,
                    cy: src.cy + dy,
                    locked: false,
                };

                set((s) => ({ panels: [...s.panels, clone] }));
                return newId;
            },


            /** UI slice */
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
                set((s) => ({ ui: { ...s.ui, leftPanelOpen: !s.ui.leftPanelOpen } })),
            openSearch: () =>
                set((state) => ({ ui: { ...state.ui, searchOpen: true } })),
            closeSearch: () =>
                set((state) => ({ ui: { ...state.ui, searchOpen: false } })),
        }),
        {
            name: 'planner-v2',
            version: 8, // ⬆️ bump

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
                panels: s.panels,
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
