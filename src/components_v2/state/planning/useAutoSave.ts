"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { usePlannerV2Store } from "../plannerV2Store";
import { savePlannerToDb, buildPlannerPayloadFromStore } from "./savePlanning";

export function useAutoSave() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId");

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    if (!planningId) return;

    const unsubscribe = usePlannerV2Store.subscribe(() => {
      const payload = buildPlannerPayloadFromStore();

      const fingerprint = JSON.stringify({
        snapshot: payload.snapshot,
        layers: payload.layers,
        zones: payload.zones,
        panels: payload.panels,
        modules: payload.modules,
        roofAlign: payload.roofAlign,
        step: payload.step,
      });

      if (fingerprint === lastSavedRef.current) return;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(async () => {
        try {
          await savePlannerToDb(planningId);
          lastSavedRef.current = fingerprint;
          console.log("autosave ok");
        } catch (err) {
          console.error("autosave failed", err);
        }
      }, 1200);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [planningId]);
}