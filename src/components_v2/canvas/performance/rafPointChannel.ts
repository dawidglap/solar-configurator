import { createLatestFrameScheduler } from "./latestFrameScheduler";

export type TransientPoint = { x: number; y: number };

export type RafPointChannel = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TransientPoint | null;
  getServerSnapshot(): null;
  publish(point: TransientPoint): void;
  clear(): void;
  destroy(): void;
};

export function createRafPointChannel(
  scheduleFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): RafPointChannel {
  let current: TransientPoint | null = null;
  const listeners = new Set<() => void>();
  const notify = (point: TransientPoint | null) => {
    current = point;
    listeners.forEach((listener) => listener());
  };
  const scheduler = createLatestFrameScheduler<TransientPoint>(
    (point) => notify(point),
    scheduleFrame,
    cancelFrame,
  );

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return current;
    },
    getServerSnapshot() {
      return null;
    },
    publish(point) {
      scheduler.schedule(point);
    },
    clear() {
      scheduler.cancel();
      if (current !== null) notify(null);
    },
    destroy() {
      scheduler.cancel();
      listeners.clear();
      current = null;
    },
  };
}
