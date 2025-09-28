// src/components_v2/state/history.ts
import { usePlannerV2Store } from './plannerV2Store';

type Listener = () => void;
type Snapshot = any;

// scegliamo esplicitamente le chiavi "data" (niente funzioni)
const ALLOWED_KEYS = [
    'snapshot',   // info immagine, mpp, url...
    'view',       // pan/zoom
    'tool',       // tool attivo
    'step',       // building/modules...
    'layers',     // tetti
    'selectedId', // selezione tetto
    'panels',     // pannelli
    'modules',    // opzioni griglia
    'zones',      // hindernis / reserved
    'ui',         // pannelli aperti/chiusi etc.
    'roofAlign',  // pivot/rotazione UI
];

// prendi solo i dati e fai deep-clone sicuro
function takeSnapshot(): Snapshot {
    const s: any = usePlannerV2Store.getState();
    const data: any = {};
    for (const k of ALLOWED_KEYS) data[k] = s[k];
    try {
        return structuredClone(data);
    } catch {
        // rimuove eventuali funzioni residue se presenti
        return JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'function' ? undefined : v)));
    }
}

class PlannerHistory {
    private undoStack: Snapshot[] = [];
    private redoStack: Snapshot[] = [];
    private listeners = new Set<Listener>();

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private notify() { for (const fn of this.listeners) fn(); }

    push(_label?: string) {
        this.undoStack.push(takeSnapshot());
        this.redoStack.length = 0;
        this.notify();
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }

    undo() {
        if (!this.canUndo()) return;
        this.redoStack.push(takeSnapshot());
        const prev = this.undoStack.pop()!;
        // ⬅️ MERGE (non replace) così non perdi le azioni/func dello store
        usePlannerV2Store.setState(prev, false);
        this.notify();
    }

    redo() {
        if (!this.canRedo()) return;
        this.undoStack.push(takeSnapshot());
        const next = this.redoStack.pop()!;
        usePlannerV2Store.setState(next, false); // merge
        this.notify();
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.notify();
    }
}

export const history = new PlannerHistory();
