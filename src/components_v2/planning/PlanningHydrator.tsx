"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function PlanningHydrator() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId");

  const setProfile = usePlannerV2Store((s) => s.setProfile);
  // se hai anche istSlice: const setIst = usePlannerV2Store((s) => s.setIst);

  useEffect(() => {
    if (!planningId) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/plannings/${planningId}`, {
          method: "GET",
          credentials: "include",
        });
        const json = await res.json();

        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          console.error("HYDRATE FAILED", json);
          return;
        }

        const data = json.planning?.data;

        // ✅ rimettiamo i dati nello store
        if (data?.profile) setProfile(data.profile);
        // se vuoi anche IST:
        // if (data?.ist) setIst(data.ist);
      } catch (e) {
        console.error("HYDRATE ERROR", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [planningId, setProfile]);

  return null; // non mostra nulla, fa solo “carica & riempi”
}
