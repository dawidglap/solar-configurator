// src/components_v2/state/planning/savePlanning.ts
"use client";

import { usePlannerV2Store } from "../plannerV2Store";

/**
 * Rimuove il payload pesante dell'immagine base64 prima del salvataggio DB.
 * Manteniamo solo i metadati necessari per ricostruire la snapshot in seguito.
 */
function buildPersistableSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return null;

  return {
    // ⚠️ NON salvare la dataUrl enorme nel DB
    url: null,

    width: snapshot.width ?? null,
    height: snapshot.height ?? null,
    mppImage: snapshot.mppImage ?? null,

    center: snapshot.center ?? null,
    zoom: snapshot.zoom ?? null,
    bbox3857: snapshot.bbox3857 ?? null,

    address: snapshot.address ?? null,
  };
}

/**
 * Prende dallo store SOLO i pezzi necessari per ricostruire la planimetria
 * (building + modules) dopo refresh / riapertura.
 *
 * Non includiamo roba UI non essenziale.
 */
export function buildPlannerPayloadFromStore() {
  const s = usePlannerV2Store.getState();

  const exported =
    typeof (s as any).exportState === "function" ? (s as any).exportState() : null;

  const persistableSnapshot = buildPersistableSnapshot(s.snapshot);

  if (exported && typeof exported === "object") {
    return {
      version: 1,
      savedAt: new Date().toISOString(),

      ...exported,

      // salviamo solo metadati snapshot, non la dataUrl
      snapshot: persistableSnapshot,
      step: s.step,
    };
  }

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    address: (s as any).address ?? null,

    snapshot: persistableSnapshot,

    layers: s.layers,
    zones: (s as any).zones ?? [],
    snowGuards: (s as any).snowGuards ?? [],
    panels: s.panels,
    modules: s.modules,
    roofAlign: (s as any).roofAlign ?? null,
    step: s.step,
  };
}

/**
 * Salva nel DB sotto data.planner.
 */
export async function savePlannerToDb(planningId: string) {
  if (!planningId) throw new Error("Missing planningId");

  const planner = buildPlannerPayloadFromStore();

  const res = await fetch(`/api/plannings/${planningId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ planner }),
  });

  if (res.status === 401) throw new Error("Not logged in (401)");

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? "Save planner failed");
  }

  return { ok: true };
}