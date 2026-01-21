// src/components_v2/state/planning/savePlanning.ts
"use client";

import { usePlannerV2Store } from "../plannerV2Store";

/**
 * Prende dallo store SOLO i pezzi necessari per ricostruire la planimetria
 * (building + modules) dopo refresh / riapertura.
 *
 * Nota: non includiamo roba UI (panel aperti, tool, selectedId...) perché non serve.
 */
export function buildPlannerPayloadFromStore() {
  const s = usePlannerV2Store.getState();

  // ✅ Se esiste exportState() nello store, usalo: è il modo più scalabile
  // (così quando aggiungi nuove parti al planner, non devi ricordarti di aggiornarlo qui)
  const exported =
    typeof (s as any).exportState === "function" ? (s as any).exportState() : null;

  if (exported && typeof exported === "object") {
    return {
      version: 1,
      savedAt: new Date().toISOString(),

      // exportState contiene lo "shape" importabile
      ...exported,

      // snapshot spesso NON è dentro exportState -> lo aggiungiamo sempre
      snapshot: s.snapshot,
    };
  }

  // ✅ Fallback legacy: mappa i pezzi manualmente
  return {
    version: 1,
    savedAt: new Date().toISOString(),

    // immagine / scala / riferimento
    snapshot: s.snapshot,

    // building (tetti) + vincoli
    layers: s.layers,
    zones: (s as any).zones ?? [],

    // neve / extra
    snowGuards: (s as any).snowGuards ?? [],

    // modules
    panels: s.panels,
    modules: s.modules,

    // opzionali ma utili (se esistono)
    roofAlign: (s as any).roofAlign ?? null,
  };
}

/**
 * Salva nel DB sotto data.planner + fa avanzare currentStep lato backend.
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
