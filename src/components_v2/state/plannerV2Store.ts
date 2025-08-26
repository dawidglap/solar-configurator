'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PlannerStep = 'building' | 'modules' | 'strings' | 'parts';
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

    // ⬇️ NUOVO: orientamento/inclinazione “fisici”
    tiltDeg?: number;        // Neigung (°)
    azimuthDeg?: number;     // Ausrichtung (°, 0=N, 90=E, 180=S, 270=W)
    source?: 'manual' | 'sonnendach';
};

type Snapshot = {
    url?: string;
    width?: number;
    height?: number;
    mppImage?: number;

    // ⬇️ NUOVO: info per georeferenziare lo snapshot
    center?: { lat: number; lon: number };   // WGS84
    zoom?: number;                           // WMTS/3857 zoom
    bbox3857?: { minX: number; minY: number; maxX: number; maxY: number }; // in metri
};

type View = { scale: number; offsetX: number; offsetY: number };

/** ✅ Catalogo pannelli (hard-coded ora, estendibile / brand-specific in futuro) */
export type PanelSpec = {
    id: string;
    brand: string;
    model: string;
    wp: number;      // potenza (W)
    widthM: number;  // lato corto in metri
    heightM: number; // lato lungo in metri
};

const PANEL_CATALOG: PanelSpec[] = [
    // valori tipici “54 celle M10” per tetti residenziali
    { id: 'GEN54-410', brand: 'Generic', model: 'M10 54c', wp: 410, widthM: 1.134, heightM: 1.722 },
    { id: 'GEN54-425', brand: 'Generic', model: 'M10 54c', wp: 425, widthM: 1.134, heightM: 1.762 },
    // formato grande (utility / industriale) – utile per futuri casi
    { id: 'GEN72-550', brand: 'Generic', model: 'M10 72c', wp: 550, widthM: 1.134, heightM: 2.279 },
];

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

    /** ✅ Catalogo + scelta corrente */
    catalogPanels: PanelSpec[];
    selectedPanelId: string;
    setSelectedPanel: (id: string) => void;
    getSelectedPanel: () => PanelSpec | undefined;
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

            detectedRoofs: [],
            setDetectedRoofs: (arr) => set({ detectedRoofs: arr }),
            clearDetectedRoofs: () => set({ detectedRoofs: [] }),

            /** ✅ Catalogo pannelli */
            catalogPanels: PANEL_CATALOG,
            selectedPanelId: PANEL_CATALOG[0].id,
            setSelectedPanel: (id) => set({ selectedPanelId: id }),
            getSelectedPanel: () => {
                const { catalogPanels, selectedPanelId } = get();
                return catalogPanels.find((p) => p.id === selectedPanelId);
            },
        }),
        {
            name: 'planner-v2',
            version: 5, // bump per includere catalogo pannelli
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({
                step: s.step,
                view: s.view,
                tool: s.tool,
                layers: s.layers,
                selectedId: s.selectedId,
                snapshotScale: s.snapshotScale,
                // ✅ Persistiamo la scelta del pannello e il catalogo base
                catalogPanels: s.catalogPanels,
                selectedPanelId: s.selectedPanelId,
            }),
            migrate: (persisted: any) => {
                if (!persisted) return persisted;
                delete persisted?.snapshot; // safety
                if (![1, 2, 3].includes(persisted.snapshotScale)) {
                    persisted.snapshotScale = 2;
                }
                if (!persisted.catalogPanels) persisted.catalogPanels = PANEL_CATALOG;
                if (!persisted.selectedPanelId) persisted.selectedPanelId = PANEL_CATALOG[0].id;
                return persisted;
            },
        }
    )
);
