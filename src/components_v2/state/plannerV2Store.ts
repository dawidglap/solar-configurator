'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isToolAllowed, defaultToolFor } from './capabilities';
import { ALLOWED_TOOLS, DEFAULT_TOOL } from '../../constants/stepTools';
import { nanoid } from 'nanoid';
import type { ProfileSlice } from './slices/profileSlice';
import { createProfileSlice, defaultProfile } from './slices/profileSlice';
import type { IstSlice } from './slices/istSlice';
import { createIstSlice, defaultIst } from './slices/istSlice';

import { history } from './history';

import type {
  PlannerStep,
  Tool,
  DetectedRoof,
  Snapshot,
  View,
  PanelSpec,
  ModulesConfig,
} from '@/types/planner';
import { PANEL_CATALOG } from '../../constants/panels';

export type {
  PlannerStep,
  UIState,
  Tool,
  Pt,
  DetectedRoof,
  RoofArea,
  Snapshot,
  View,
  PanelSpec,
  ModulesConfig,
  PanelInstance,
} from '@/types/planner';

export type SnowGuard = {
  id: string;
  roofId: string;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  lengthM?: number;
  pricePerM?: number;
};

import type { UISlice } from './slices/uiSlice';
import { createUiSlice } from './slices/uiSlice';

import type { PanelsSlice } from './slices/panelsSlice';
import { createPanelsSlice } from './slices/panelsSlice';

import type { LayersSlice } from './slices/layersSlice';
import { createLayersSlice } from './slices/layersSlice';

import type { ZonesSlice } from './slices/zonesSlice';
import { createZonesSlice } from './slices/zonesSlice';

import type { PartsSlice } from './slices/partsSlice';
import { createPartsSlice } from './slices/partsSlice';

type RoofAlign = {
  rotDeg: number;
  pivotPx?: { x: number; y: number };
};

type PlannerV2State = {
  step: PlannerStep;
  setStep: (s: PlannerStep) => void;
  snapshot: Snapshot;
  setSnapshot: (s: Partial<Snapshot>) => void;

  resetForNewAddress: (snap: Partial<Snapshot>) => void;

  snapshotScale: 1 | 2 | 3;
  setSnapshotScale: (n: 1 | 2 | 3) => void;
  view: View;
  setView: (v: Partial<View>) => void;
  tool: Tool;
  setTool: (t: Tool) => void;

  catalogPanels: PanelSpec[];
  selectedPanelId: string;
  setSelectedPanel: (id: string) => void;
  getSelectedPanel: () => PanelSpec | undefined;
  modules: ModulesConfig;
  setModules: (patch: Partial<ModulesConfig>) => void;

  detectedRoofs: DetectedRoof[];
  setDetectedRoofs: (
    arr: DetectedRoof[],
    meta?: { mppImage?: number; width?: number; height?: number }
  ) => void;
  clearDetectedRoofs: () => void;

  roofAlign: RoofAlign;
  setRoofRotDeg: (deg: number) => void;
  setRoofPivotPx: (p?: { x: number; y: number }) => void;
  resetRoofAlign: () => void;
  duplicateRoof: (id: string) => string | undefined;

  snowGuards: SnowGuard[];
  addSnowGuard: (sg: SnowGuard) => void;
  updateSnowGuard: (id: string, patch: Partial<SnowGuard>) => void;
  deleteSnowGuard: (id: string) => void;
  selectedSnowGuardId?: string;
  setSelectedSnowGuard: (id?: string) => void;

  exportState: () => any;
  importState: (saved: any) => void;
} & UISlice &
  LayersSlice &
  PanelsSlice &
  ZonesSlice &
  ProfileSlice &
  IstSlice &
  PartsSlice;

export const usePlannerV2Store = create<PlannerV2State>()(
  persist(
    (set, get, api) => ({
      step: 'profile',

      setStep: (s) =>
        set((st) => {
          const allowed = ALLOWED_TOOLS[s as keyof typeof ALLOWED_TOOLS];

          if (!allowed) {
            return { step: s };
          }

          const nextTool = allowed.includes(st.tool)
            ? st.tool
            : DEFAULT_TOOL[s as keyof typeof DEFAULT_TOOL];

          return { step: s, tool: nextTool };
        }),

      snapshot: {},
      setSnapshot: (s) =>
        set((st) => ({ snapshot: { ...st.snapshot, ...s } })),

      resetForNewAddress: (snap: Partial<Snapshot>) => {
        set((s) => ({
          snapshot: { ...s.snapshot, ...snap },

          view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
          tool: 'select',
          step: 'building',
          roofAlign: { rotDeg: 0, pivotPx: undefined },

          selectedId: undefined,
          selectedZoneId: undefined,

          layers: [],
          zones: [],
          panels: [],
          detectedRoofs: [],

          snowGuards: [],
          selectedSnowGuardId: undefined,

          modules: {
            ...s.modules,
            gridAngleDeg: 0,
            gridPhaseX: 0,
            gridPhaseY: 0,
            coverageRatio: 1,
            perRoofAngles: {},
          },
        }));
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
          catalogPanels: s.catalogPanels,

          profile: s.profile,
          ist: s.ist,
          parts: s.parts,
        };
      },

      importState: (saved: any) => {
        if (!saved || typeof saved !== 'object') return;

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

          snowGuards: Array.isArray(saved.snowGuards)
            ? saved.snowGuards
            : s.snowGuards,

          selectedPanelId: saved.selectedPanelId ?? s.selectedPanelId,
          catalogPanels:
            Array.isArray(saved.catalogPanels) && saved.catalogPanels.length > 0
              ? saved.catalogPanels
              : s.catalogPanels,

          profile: saved.profile ?? s.profile,
          ist: saved.ist ?? s.ist,
        }));

        history.clear();
      },

      snapshotScale: 2,
      setSnapshotScale: (n) => set({ snapshotScale: n }),

      view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
      setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),

      tool: 'select',
      setTool: (t) =>
        set((st) => {
          if (!isToolAllowed(st.step, t)) {
            const safe = isToolAllowed(st.step, st.tool)
              ? st.tool
              : defaultToolFor(st.step);
            return { tool: safe };
          }
          return { tool: t };
        }),

      catalogPanels: PANEL_CATALOG,
      selectedPanelId: PANEL_CATALOG[0].id,
      setSelectedPanel: (id) => set({ selectedPanelId: id }),
      getSelectedPanel: () => {
        const { catalogPanels, selectedPanelId } = get();
        return catalogPanels.find((p) => p.id === selectedPanelId);
      },

      modules: {
        orientation: 'portrait',
        spacingM: 0.02,
        marginM: 0.0,
        showGrid: true,
        placingSingle: false,
        gridAngleDeg: 0,
        gridPhaseX: 0,
        gridPhaseY: 0,
        gridAnchorX: 'start',
        gridAnchorY: 'start',
        coverageRatio: 1,
        perRoofAngles: {},
      },
      setModules: (patch) =>
        set((s) => {
          const prev = s.modules || {};
          const prevAngles = { ...(prev.perRoofAngles || {}) };

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
              ...(patch.perRoofAngles
                ? { perRoofAngles: nextPerRoof }
                : {}),
            },
          };
        }),

      detectedRoofs: [],

      setDetectedRoofs: (arr, meta) =>
        set((s) => ({
          detectedRoofs: arr,
          snapshot: meta ? { ...s.snapshot, ...meta } : s.snapshot,
        })),
      clearDetectedRoofs: () => set({ detectedRoofs: [] }),

      roofAlign: { rotDeg: 0, pivotPx: undefined },

      setRoofRotDeg: (deg) =>
        set((s) => ({
          roofAlign: {
            ...s.roofAlign,
            rotDeg: Math.max(-30, Math.min(30, deg)),
          },
        })),

      setRoofPivotPx: (p) =>
        set((s) => ({ roofAlign: { ...s.roofAlign, pivotPx: p } })),

      resetRoofAlign: () =>
        set(() => ({ roofAlign: { rotDeg: 0, pivotPx: undefined } })),

      duplicateRoof: (id: string) => {
        let newId: string | undefined;

        set((state) => {
          const roof = state.layers.find((l: any) => l.id === id);
          if (!roof) return state;

          const OFFSET = 20;
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

          history.push(JSON.stringify(next));
          return next;
        });

        return newId;
      },

      snowGuards: [],

      addSnowGuard: (sg: SnowGuard) =>
        set((state) => {
          const next = {
            ...state,
            snowGuards: [...state.snowGuards, sg],
          };
          history.push(JSON.stringify(next));
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
          history.push(JSON.stringify(next));
          return next;
        }),

      deleteSnowGuard: (id: string) =>
        set((state) => {
          const next = {
            ...state,
            snowGuards: state.snowGuards.filter((s) => s.id !== id),
          };
          history.push(JSON.stringify(next));
          return next;
        }),

      selectedSnowGuardId: undefined,
      setSelectedSnowGuard: (id) => set({ selectedSnowGuardId: id }),

      ...createUiSlice(set, get, api),
      ...createLayersSlice(set, get, api),
      ...createPanelsSlice(set, get, api),
      ...createZonesSlice(set, get, api),
      ...createProfileSlice(set, get, api),
      ...createIstSlice(set, get, api),
      ...createPartsSlice(set, get, api),
    }),
    {
      name: 'planner-v2',
      version: 13,

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
        zones: s.zones,
        selectedZoneId: s.selectedZoneId,
        roofAlign: s.roofAlign,
        snowGuards: s.snowGuards,
        selectedSnowGuardId: s.selectedSnowGuardId,
        profile: s.profile,
        ist: s.ist,
        partsView: s.partsView,
        parts: s.parts,
      }),

      migrate: (persisted: any, fromVersion?: number) => {
        if (!persisted) return persisted;

        if (!persisted.profile) {
          persisted.profile = defaultProfile;
        }

        if (!persisted.ist) {
          persisted.ist = defaultIst;
        }

        if (!persisted.parts) {
          persisted.parts = { items: [] };
        }
        if (!Array.isArray(persisted.parts.items)) {
          persisted.parts.items = [];
        }

        if ((fromVersion ?? 0) < 13) {
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

        if (!Array.isArray(persisted.zones)) {
          persisted.zones = [];
        }
        if (persisted.selectedZoneId) {
          const exists = persisted.zones.some(
            (z: any) => z.id === persisted.selectedZoneId
          );
          if (!exists) persisted.selectedZoneId = undefined;
        }

        if (!Array.isArray(persisted.snowGuards)) {
          persisted.snowGuards = [];
        }

        delete persisted?.snapshot;

        if (![1, 2, 3].includes(persisted.snapshotScale)) {
          persisted.snapshotScale = 2;
        }

        if (!persisted.catalogPanels) persisted.catalogPanels = PANEL_CATALOG;
        if (!persisted.selectedPanelId) {
          persisted.selectedPanelId = PANEL_CATALOG[0].id;
        }

        if (!persisted.view) {
          persisted.view = {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            fitScale: 1,
          };
        }
        if (typeof persisted.view.fitScale !== 'number') {
          persisted.view.fitScale = 1;
        }

        if (!persisted.modules) {
          persisted.modules = {
            orientation: 'portrait',
            spacingM: 0.02,
            marginM: 0.2,
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

        if (!Array.isArray(persisted.panels)) {
          persisted.panels = [];
        } else {
          const fallbackPanelId =
            (persisted.selectedPanelId as string) || PANEL_CATALOG[0].id;
          persisted.panels = persisted.panels.map((p: any) => ({
            ...p,
            panelId: p.panelId ?? fallbackPanelId,
          }));
        }

        if (typeof persisted.modules.gridPhaseX !== 'number') {
          persisted.modules.gridPhaseX = 0;
        }
        if (typeof persisted.modules.gridPhaseY !== 'number') {
          persisted.modules.gridPhaseY = 0;
        }
        if (!['start', 'center', 'end'].includes(persisted.modules.gridAnchorX)) {
          persisted.modules.gridAnchorX = 'start';
        }
        if (!['start', 'center', 'end'].includes(persisted.modules.gridAnchorY)) {
          persisted.modules.gridAnchorY = 'start';
        }

        if (typeof persisted.modules.coverageRatio !== 'number') {
          persisted.modules.coverageRatio = 1;
        }

        if (!persisted.roofAlign) {
          persisted.roofAlign = { rotDeg: 0, pivotPx: undefined };
        } else {
          if (typeof persisted.roofAlign.rotDeg !== 'number') {
            persisted.roofAlign.rotDeg = 0;
          }
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

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // @ts-expect-error debug helper
  window.plannerStore = usePlannerV2Store;
}