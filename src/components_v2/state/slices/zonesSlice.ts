'use client';
import type { StateCreator } from 'zustand';
import type { Pt } from '@/types/planner';

export type Zone = {
    id: string;
    roofId: string;
    type: 'riservata' | 'walkway';
    points: Pt[]; // 4 pt parallelogramma
};

export type ZonesSlice = {
    zones: Zone[];
    selectedZoneId?: string;

    addZone: (z: Zone) => void;
    removeZone: (id: string) => void;
    setSelectedZone: (id?: string) => void;
    getZonesForRoof: (roofId: string) => Zone[];
    clearZonesForRoof: (roofId: string) => void;
};

export const createZonesSlice: StateCreator<ZonesSlice, [], [], ZonesSlice> = (set, get) => ({
    zones: [],
    selectedZoneId: undefined,

    addZone: (z) =>
        set((s) => ({
            zones: [...s.zones, z],
            selectedZoneId: z.id,
        })),

    removeZone: (id) =>
        set((s) => ({
            zones: s.zones.filter((z) => z.id !== id),
            selectedZoneId: s.selectedZoneId === id ? undefined : s.selectedZoneId,
        })),

    setSelectedZone: (id) => set({ selectedZoneId: id }),

    getZonesForRoof: (roofId) => get().zones.filter((z) => z.roofId === roofId),

    clearZonesForRoof: (roofId) =>
        set((s) => ({
            zones: s.zones.filter((z) => z.roofId !== roofId),
            selectedZoneId:
                s.selectedZoneId && s.zones.find((z) => z.id === s.selectedZoneId)?.roofId === roofId
                    ? undefined
                    : s.selectedZoneId,
        })),
});
