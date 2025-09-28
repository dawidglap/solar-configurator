// src/components_v2/state/actions/importRoofs.ts
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';

type RoofPx = {
    id: string;
    pointsPx: { x: number; y: number }[];
    tiltDeg?: number;
    azimuthDeg?: number;
};

export function commitSonnendachRoofs(roofs: RoofPx[]) {
    const { addRoof } = usePlannerV2Store.getState();
    // opzionale: una clear mirata se vuoi cancellare prima i "source: sonnendach"
    const { layers } = usePlannerV2Store.getState();
    const old = layers.filter(l => (l as any)?.source === 'sonnendach');
    if (old.length) {
        const { deleteRoof } = usePlannerV2Store.getState() as any;
        if (typeof deleteRoof === 'function') {
            old.forEach(r => deleteRoof(r.id));
        }
    }

    roofs.forEach((p, idx) => {
        addRoof({
            id: `sd_${p.id}_${idx}`,
            name: `Roof ${idx + 1}`,
            points: p.pointsPx,
            azimuthDeg: p.azimuthDeg,
            tiltDeg: p.tiltDeg,
            source: 'sonnendach',   // campo libero, utile per reimport/clear
        } as any);
    });

    // seleziona la prima falda appena importata
    const first = roofs[0];
    if (first) {
        const { select } = usePlannerV2Store.getState();
        select(`sd_${first.id}_0`);
    }
}
