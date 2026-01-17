"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePlannerV2Store } from "./plannerV2Store";

/** normalizza stringhe tipo "Herr"/"Frau" -> "herr"/"frau" */
function mapSalutation(v: any): "herr" | "frau" | "" {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("herr")) return "herr";
  if (s.includes("frau")) return "frau";
  return "";
}

/** API profile -> Store profile (quello che usa ProfileStep) */
function mapApiProfileToStore(api: any) {
  const customerType = String(api?.customerKind ?? "").toLowerCase(); // "privat" | "firma"
  const customerStatus = String(api?.customerType ?? "").toLowerCase(); // "new" | "existing"

  return {
    // top
    customerStatus: customerStatus === "existing" ? "existing" : "new",
    customerType: customerType === "firma" || customerType === "company" ? "company" : "private",
    source: api?.source ?? "",

    legalForm: api?.legalForm ?? "",

    // contact
    contactSalutation: mapSalutation(api?.contact?.salutation),
    contactFirstName: api?.contact?.firstName ?? "",
    contactLastName: api?.contact?.lastName ?? "",
    contactMobile: api?.contact?.mobile ?? api?.contact?.phone ?? "",
    contactEmail: api?.contact?.email ?? "",

    // building address
    buildingStreet: api?.buildingAddress?.street ?? api?.building?.street ?? "",
    buildingStreetNo: api?.buildingAddress?.streetNo ?? api?.building?.streetNo ?? "",
    buildingCity: api?.buildingAddress?.city ?? api?.building?.city ?? "",
    buildingZip: api?.buildingAddress?.zip ?? api?.building?.zip ?? "",

    // billing address
    billingStreet: api?.billingAddress?.street ?? "",
    billingStreetNo: api?.billingAddress?.streetNo ?? "",
    billingCity: api?.billingAddress?.city ?? "",
    billingZip: api?.billingAddress?.zip ?? "",

    // lead
    leadLabel: api?.leadLabel ?? "",

    // business
    businessName: api?.business?.name ?? "",
    businessStreet: api?.business?.street ?? "",
    businessStreetNo: api?.business?.streetNo ?? "",
    businessCity: api?.business?.city ?? "",
    businessZip: api?.business?.zip ?? "",
    businessPhone: api?.business?.phone ?? "",
    businessEmail: api?.business?.email ?? "",
    businessWebsite: api?.business?.website ?? "",
  };
}

/** (opzionale) API ist -> store ist (se hai già ist nello store) */
function mapApiIstToStore(api: any) {
  // tienilo minimale: salva quello che hai già nel backend
  return {
    roofType: api?.roofType ?? "",
    coverage: api?.coverage ?? "",
    notes: api?.notes ?? "",
    photos: Array.isArray(api?.photos) ? api.photos : [],
  };
}

export function usePlanningLoad() {
  const sp = useSearchParams();
  const router = useRouter();

  // ⚠️ nel tuo URL è planningId (non planningID ecc.)
  const planningId = sp.get("planningId");

  const importState = usePlannerV2Store((s) => s.importState);
  const setStep = usePlannerV2Store((s) => s.setStep);

  useEffect(() => {
    if (!planningId) return;

    (async () => {
      const res = await fetch(`/api/plannings/${planningId}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) return;

      const planning = json.planning;
      const data = planning?.data ?? {};

      // ✅ apriamo SEMPRE da step 1
      setStep("profile");

      // ✅ 1) PROFILE: map API -> store shape (quella del tuo ProfileStep)
      if (data.profile && typeof data.profile === "object") {
        const mapped = mapApiProfileToStore(data.profile);
        usePlannerV2Store.setState({ profile: mapped } as any);
      }

      // ✅ 2) IST: se nello store hai "ist" e un setter, popolalo qui
      if (data.ist && typeof data.ist === "object") {
        // se hai nello store: setIst(patch)
        const st: any = usePlannerV2Store.getState();
        if (typeof st.setIst === "function") {
          st.setIst(mapApiIstToStore(data.ist));
        } else {
          // fallback: se nello store esiste "ist" direttamente
          if ("ist" in st) usePlannerV2Store.setState({ ist: mapApiIstToStore(data.ist) } as any);
        }
      }

      // ✅ 3) PLANNER: il tuo DB ha planner nel formato "version/roof/modules",
      // NON nello store format (layers/panels/zones).
      // Quindi per ora NON lo importiamo nello store, altrimenti non serve a nulla.
      // Quando vuoi, faremo un mapper anche per quello.
      // const savedPlanner = data.planner;

      // ✅ pulisci undo/redo
      const h: any = (await import("./history")).history;
      h?.clear?.();
    })();
  }, [planningId, importState, setStep, router]);
}
