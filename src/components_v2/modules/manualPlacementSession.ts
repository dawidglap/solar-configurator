"use client";

import { useSyncExternalStore } from "react";

export type ManualPlacementKind = "standard-module" | "advanced-block";

export type ManualPlacementSession = {
  roofId: string;
  kind: ManualPlacementKind;
};

let current: ManualPlacementSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function beginManualPlacement(session: ManualPlacementSession): void {
  current = { ...session };
  emit();
}

export function endManualPlacement(): void {
  if (!current) return;
  current = null;
  emit();
}

/** Canonical exit shared by Escape, shortcut A and the Auswählen toolbar action. */
export function exitManualPlacementToSelect(
  setTool: (tool: "select") => void,
): void {
  endManualPlacement();
  setTool("select");
}

export function getManualPlacementSession(): ManualPlacementSession | null {
  return current;
}

export function subscribeManualPlacement(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useManualPlacementSession(): ManualPlacementSession | null {
  return useSyncExternalStore(
    subscribeManualPlacement,
    getManualPlacementSession,
    () => null,
  );
}
