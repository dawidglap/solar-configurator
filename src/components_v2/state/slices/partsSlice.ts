// src/components_v2/state/slices/partsSlice.ts
import type { StateCreator } from "zustand";

export type LineItem = {
  id: string;
  kategorie: string;
  marke: string;
  beschreibung: string;
  einzelpreis: number; // CHF
  stk: number;
  einheit?: string;
  optional?: boolean;
};

export type PartsState = {
  items: LineItem[];
};

// ✅ NEW: view state per UI (così v2store può persisterlo senza errori)
export type PartsView = "list" | "categories"; // cambia/estendi quando vuoi
export const defaultPartsView: PartsView = "list";

export type PartsSlice = {
  // ✅ NEW
  partsView: PartsView;
  setPartsView: (v: PartsView) => void;

  parts: PartsState;
  setParts: (patch: Partial<PartsState>) => void;

  addPart: (item: LineItem) => void;
  removePart: (id: string) => void;
  updatePart: (id: string, patch: Partial<LineItem>) => void;

  getPartsTotals: () => { extrasTotal: number };
};

export const defaultParts: PartsState = {
  items: [],
};

export const createPartsSlice: StateCreator<PartsSlice, [], [], PartsSlice> = (
  set,
  get
) => ({
  // ✅ NEW default
  partsView: defaultPartsView,
  setPartsView: (v) => set({ partsView: v }),

  parts: defaultParts,

  setParts: (patch) =>
    set((s: any) => ({ parts: { ...(s.parts || defaultParts), ...patch } })),

  addPart: (item) =>
    set((s: any) => ({
      parts: {
        ...(s.parts || defaultParts),
        items: [item, ...(s.parts?.items || [])],
      },
    })),

  removePart: (id) =>
    set((s: any) => ({
      parts: {
        ...(s.parts || defaultParts),
        items: (s.parts?.items || []).filter((x: LineItem) => x.id !== id),
      },
    })),

  updatePart: (id, patch) =>
    set((s: any) => ({
      parts: {
        ...(s.parts || defaultParts),
        items: (s.parts?.items || []).map((x: LineItem) =>
          x.id === id ? { ...x, ...patch } : x
        ),
      },
    })),

  getPartsTotals: () => {
    const items = get().parts?.items || [];
    const extrasTotal = items.reduce((acc, r) => acc + r.einzelpreis * r.stk, 0);
    return { extrasTotal };
  },
});
