import type { PanelInstance } from "@/types/planner";

export type TransientPanelGeometry = Pick<PanelInstance, "cx" | "cy" | "angleDeg">;

const EMPTY: TransientPanelGeometry | undefined = undefined;
const geometry = new Map<string, TransientPanelGeometry>();
const listeners = new Map<string, Set<() => void>>();

function notify(id: string): void {
  listeners.get(id)?.forEach((listener) => listener());
}

export function setTransientPanelGeometry(
  values: ReadonlyMap<string, TransientPanelGeometry>,
): void {
  const changed = new Set<string>();
  values.forEach((value, id) => {
    const previous = geometry.get(id);
    if (
      previous?.cx === value.cx &&
      previous.cy === value.cy &&
      previous.angleDeg === value.angleDeg
    ) return;
    geometry.set(id, value);
    changed.add(id);
  });
  changed.forEach(notify);
}

export function clearTransientPanelGeometry(ids: readonly string[]): void {
  ids.forEach((id) => {
    if (!geometry.delete(id)) return;
    notify(id);
  });
}

export function subscribeTransientPanelGeometry(
  id: string,
  listener: () => void,
): () => void {
  const current = listeners.get(id) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(id, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(id);
  };
}

export function getTransientPanelGeometry(id: string): TransientPanelGeometry | undefined {
  return geometry.get(id) ?? EMPTY;
}
