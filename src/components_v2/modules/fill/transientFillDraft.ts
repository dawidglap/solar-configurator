import type { Pt } from "@/types/planner";

export type TransientFillRect = {
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  angleDeg: number;
};

export type TransientFillDraft = {
  a: Pt;
  b: Pt;
  poly: Pt[];
  rects: TransientFillRect[];
};

/** Pointer frames notify only the lightweight preview, never Zustand/CanvasStage. */
export function createTransientFillDraftChannel() {
  let current: TransientFillDraft | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: TransientFillDraft | null) => {
    if (current === next) return;
    current = next;
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return current;
    },
    getServerSnapshot(): null {
      return null;
    },
    publish,
    clear() {
      publish(null);
    },
    destroy() {
      current = null;
      listeners.clear();
    },
  };
}

export type TransientFillDraftChannel = ReturnType<typeof createTransientFillDraftChannel>;
