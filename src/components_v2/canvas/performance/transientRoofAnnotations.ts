import type { Pt } from "@/types/planner";

const values = new Map<string, readonly Pt[]>();
const pending = new Map<string, readonly Pt[]>();
const listeners = new Map<string, Set<() => void>>();
let frame: number | null = null;

function notify(roofId: string) {
  listeners.get(roofId)?.forEach((listener) => listener());
}

function flush() {
  frame = null;
  pending.forEach((points, roofId) => {
    values.set(roofId, points);
    notify(roofId);
  });
  pending.clear();
}

export function publishTransientRoofAnnotationPoints(roofId: string, points: readonly Pt[]) {
  pending.set(roofId, points.map((point) => ({ x: point.x, y: point.y })));
  if (frame !== null) return;
  if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(flush);
  else flush();
}

export function clearTransientRoofAnnotationPoints(roofId: string) {
  pending.delete(roofId);
  if (!values.delete(roofId)) return;
  notify(roofId);
}

export function subscribeTransientRoofAnnotationPoints(roofId: string, listener: () => void) {
  const roofListeners = listeners.get(roofId) ?? new Set<() => void>();
  roofListeners.add(listener);
  listeners.set(roofId, roofListeners);
  return () => {
    roofListeners.delete(listener);
    if (!roofListeners.size) listeners.delete(roofId);
  };
}

export function getTransientRoofAnnotationPoints(roofId: string): readonly Pt[] | null {
  return values.get(roofId) ?? null;
}
