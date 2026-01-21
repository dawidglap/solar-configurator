'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// ⬇️ NEW
import { isToolAllowed, defaultToolFor } from './capabilities';
import { ALLOWED_TOOLS, DEFAULT_TOOL } from '../../constants/stepTools';
import { nanoid } from 'nanoid';
import type { ProfileSlice } from './slices/profileSlice';
import { createProfileSlice, defaultProfile } from './slices/profileSlice';
import type { IstSlice } from './slices/istSlice';
import { createIstSlice, defaultIst } from './slices/istSlice';



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

// protezioni neve (linee)
export type SnowGuard = {
    id: string;
    roofId: string;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    lengthM?: number;
    pricePerM?: number;
};


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

    resetForNewAddress: (snap: Partial<Snapshot>) => void;

    

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
    setDetectedRoofs: (arr: DetectedRoof[], meta?: { mppImage?: number; width?: number; height?: number }) => void;
    clearDetectedRoofs: () => void;

    roofAlign: RoofAlign;
    setRoofRotDeg: (deg: number) => void;
    setRoofPivotPx: (p?: { x: number; y: number }) => void;
    resetRoofAlign: () => void;
        duplicateRoof: (id: string) => string | undefined;


    // 👇👇👇 AGGIUNGI QUESTO
    snowGuards: SnowGuard[];
    addSnowGuard: (sg: SnowGuard) => void;
    updateSnowGuard: (id: string, patch: Partial<SnowGuard>) => void;
    deleteSnowGuard: (id: string) => void;
    selectedSnowGuardId?: string;
    setSelectedSnowGuard: (id?: string) => void;
    exportState: () => any;
importState: (saved: any) => void;
} & UISlice & LayersSlice & PanelsSlice & ZonesSlice & ProfileSlice & IstSlice;






export const usePlannerV2Store = create<PlannerV2State>()(
    persist(
        (set, get, api) => ({
            // ── Step
            step: 'profile',

        setStep: (s) =>
  set((st) => {
    // solo per gli step che hanno tools definiti
    const allowed = ALLOWED_TOOLS[s as keyof typeof ALLOWED_TOOLS];

    if (!allowed) {
      // profile / ist / report / offer → non tocchiamo il tool
      return { step: s };
    }

    const nextTool = allowed.includes(st.tool)
      ? st.tool
      : DEFAULT_TOOL[s as keyof typeof DEFAULT_TOOL];

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

                    // 👇 aggiungi questi
                    snowGuards: [],
                    selectedSnowGuardId: undefined,

                    // (opzionale) reset leggeri della griglia
                    modules: {
                        ...s.modules,
                        gridAngleDeg: 0,
                        gridPhaseX: 0,
                        gridPhaseY: 0,
                        coverageRatio: 1,
                        perRoofAngles: {},
                    },
                }));
                // niente “undo” verso il progetto precedente
                history.clear();
            },

            exportState: () => {
  const s = get();
  return {
    step: s.step,
    view: s.view,
    tool: s.tool,
    snapshotScale: s.snapshotScale,

    layers: s.layers,
    zones: s.zones,
    panels: s.panels,

    modules: s.modules,
    roofAlign: s.roofAlign,

    snowGuards: s.snowGuards,
    selectedPanelId: s.selectedPanelId,

    profile: s.profile,
    ist: s.ist,

  };
},

importState: (saved: any) => {
  if (!saved || typeof saved !== "object") return;

  set((s) => ({
    ...s,
    step: saved.step ?? s.step,
    view: saved.view ?? s.view,
    tool: saved.tool ?? s.tool,
    snapshotScale: saved.snapshotScale ?? s.snapshotScale,

    layers: Array.isArray(saved.layers) ? saved.layers : s.layers,
    zones: Array.isArray(saved.zones) ? saved.zones : s.zones,
    panels: Array.isArray(saved.panels) ? saved.panels : s.panels,

    modules: saved.modules ?? s.modules,
    roofAlign: saved.roofAlign ?? s.roofAlign,

    snowGuards: Array.isArray(saved.snowGuards) ? saved.snowGuards : s.snowGuards,
    selectedPanelId: saved.selectedPanelId ?? s.selectedPanelId,

    profile: saved.profile ?? s.profile,
    ist: saved.ist ?? s.ist,

  }));

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
                marginM: 0.00,
                // marginM: 0.20,
                showGrid: true,
                placingSingle: false,
                gridAngleDeg: 0,
                gridPhaseX: 0,             // 👈 nuovo
                gridPhaseY: 0,             // 👈 nuovo
                gridAnchorX: 'start',      // 👈 nuovo: 'start' | 'center' | 'end'
                gridAnchorY: 'start',      // 👈 nuovo
                coverageRatio: 1,
                perRoofAngles: {},
            },
            setModules: (patch) =>
                set((s) => {
                    const prev = s.modules || {};
                    const prevAngles = { ...(prev.perRoofAngles || {}) };

                    // merge speciale per perRoofAngles
                    let nextPerRoof = prevAngles;
                    if (patch.perRoofAngles) {
                        for (const [roofId, val] of Object.entries(patch.perRoofAngles)) {
                            if (val === undefined) {
                                delete nextPerRoof[roofId];
                            } else {
                                nextPerRoof[roofId] = val;
                            }
                        }
                    }

                    return {
                        modules: {
                            ...prev,
                            ...patch,
                            ...(patch.perRoofAngles ? { perRoofAngles: nextPerRoof } : {}),
                        },
                    };
                }),



            // ── Sonnendach rilevati
            detectedRoofs: [],

            setDetectedRoofs: (arr, meta) =>
                set((s) => ({
                    detectedRoofs: arr,
                    snapshot: meta ? { ...s.snapshot, ...meta } : s.snapshot, // 👈 salva mpp/size se passato
                })),
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

            // ── Duplica falda tetto
            duplicateRoof: (id: string) => {
                let newId: string | undefined;

                set((state) => {
                    const roof = state.layers.find((l: any) => l.id === id);
                    if (!roof) return state;

                    const OFFSET = 20; // piccolo offset per non sovrapporlo esattamente
                    const newPoints = (roof.points ?? []).map((p: any) => ({
                        x: p.x + OFFSET,
                        y: p.y + OFFSET,
                    }));

                    newId = nanoid();

                    const copy = {
                        ...roof,
                        id: newId,
                        name: roof.name ? `${roof.name} (Kopie)` : 'Dach (Kopie)',
                        points: newPoints,
                    };

                    const next = {
                        ...state,
                        layers: [...state.layers, copy],
                    };

                    // aggiungiamo allo storico per l'undo
                    history.push(JSON.stringify(next));
                    return next;
                });

                return newId;
            },

            // ── Snow guards (protezioni neve)
            snowGuards: [],


    

            addSnowGuard: (sg: SnowGuard) =>
                set((state) => {
                    const next = {
                        ...state,
                        snowGuards: [...state.snowGuards, sg],
                    };
                    history.push(JSON.stringify(next)); // ✅ ora è una stringa
                    return next;
                }),


            updateSnowGuard: (id: string, patch: Partial<SnowGuard>) =>
                set((state) => {
                    const next = {
                        ...state,
                        snowGuards: state.snowGuards.map((s) =>
                            s.id === id ? { ...s, ...patch } : s
                        ),
                    };
                    history.push(JSON.stringify(next)); // ✅ string
                    return next;
                }),

            deleteSnowGuard: (id: string) =>
                set((state) => {
                    const next = {
                        ...state,
                        snowGuards: state.snowGuards.filter((s) => s.id !== id),
                    };
                    history.push(JSON.stringify(next)); // ✅ string
                    return next;
                }),


            selectedSnowGuardId: undefined,
            setSelectedSnowGuard: (id) => set({ selectedSnowGuardId: id }),




            // ── UI slice
            ...createUiSlice(set, get, api),

            // ── Layers slice
            ...createLayersSlice(set, get, api),

            // ── Panels slice
            ...createPanelsSlice(set, get, api),
            // ── Zones slice
            ...createZonesSlice(set, get, api),

            // ── Profile slice
...createProfileSlice(set, get, api),

// ── IST slice
...createIstSlice(set, get, api),


        }),
        {
            name: 'planner-v2',
            version: 12,

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
                snowGuards: s.snowGuards,
                selectedSnowGuardId: s.selectedSnowGuardId,
                 profile: s.profile,  
                 ist: s.ist,



            }),


migrate: (persisted: any, fromVersion?: number) => {
  if (!persisted) return persisted;

  // 🔹 default profile se assente
  if (!persisted.profile) {
    persisted.profile = defaultProfile;
  }

  if (!persisted.ist) {
  persisted.ist = defaultIst;
}


  // 🔹 per tutte le versioni precedenti alla 12, partiamo da 'profile'
  if ((fromVersion ?? 0) < 12) {
    persisted.step = 'profile';
  }

  const validSteps: PlannerStep[] = [
    'profile',
    'ist',
    'building',
    'modules',
    'strings',
    'parts',
    'report',
    'offer',
  ];

  if (!validSteps.includes(persisted.step)) {
    persisted.step = 'profile';
  }

                // ensure zones slice
                if (!Array.isArray(persisted.zones)) {
                    persisted.zones = [];
                }
                if (persisted.selectedZoneId) {
                    const exists = persisted.zones.some((z: any) => z.id === persisted.selectedZoneId);
                    if (!exists) persisted.selectedZoneId = undefined;
                }

                // ensure snowGuards
                if (!Array.isArray(persisted.snowGuards)) {
                    persisted.snowGuards = [];
                }

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
                if (!persisted.modules.perRoofAngles) {
                    persisted.modules.perRoofAngles = {};
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
