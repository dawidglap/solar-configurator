"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePlannerV2Store } from "./plannerV2Store";

/** normalizza "Herr"/"Frau" -> "herr"/"frau" */
function mapSalutation(v: any): "herr" | "frau" | null {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("herr")) return "herr";
  if (s.includes("frau")) return "frau";
  return null;
}

/** ✅ fallback: vecchia shape API -> nuova shape store */
function mapLegacyApiProfileToStore(api: any) {
  const customerType = String(api?.customerKind ?? "").toLowerCase();
  const customerStatus = String(api?.customerType ?? "").toLowerCase();

  return {
    customerStatus: customerStatus === "existing" ? "existing" : "new",
    customerType:
      customerType === "firma" || customerType === "company" ? "company" : "private",
    source: api?.source ?? "",
    legalForm: api?.legalForm ?? "",

    contactSalutation: mapSalutation(api?.contact?.salutation),
    contactFirstName: api?.contact?.firstName ?? "",
    contactLastName: api?.contact?.lastName ?? "",
    contactMobile: api?.contact?.mobile ?? api?.contact?.phone ?? "",
    contactEmail: api?.contact?.email ?? "",

    buildingStreet: api?.buildingAddress?.street ?? api?.building?.street ?? "",
    buildingStreetNo: api?.buildingAddress?.streetNo ?? api?.building?.streetNo ?? "",
    buildingCity: api?.buildingAddress?.city ?? api?.building?.city ?? "",
    buildingZip: api?.buildingAddress?.zip ?? api?.building?.zip ?? "",

    billingStreet: api?.billingAddress?.street ?? "",
    billingStreetNo: api?.billingAddress?.streetNo ?? "",
    billingCity: api?.billingAddress?.city ?? "",
    billingZip: api?.billingAddress?.zip ?? "",

    leadLabel: api?.leadLabel ?? "",

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

/** ✅ capiamo se il profile è già in “store shape” */
function looksLikeStoreProfile(p: any) {
  if (!p || typeof p !== "object") return false;
  // uno o due campi “firma” che nel tuo store esistono di sicuro
  return (
    "contactFirstName" in p ||
    "contactLastName" in p ||
    "customerStatus" in p ||
    "customerType" in p
  );
}

export function usePlanningLoad() {
  const sp = useSearchParams();
  const router = useRouter();
  const planningId = sp.get("planningId");

  const setStep = usePlannerV2Store((s) => s.setStep);
  const setProfile = usePlannerV2Store((s) => s.setProfile);
  const importState = usePlannerV2Store((s) => s.importState); // lo useremo dopo

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

      // ✅ apriamo SEMPRE da step 1 (poi miglioriamo usando currentStep)
      setStep("profile");

      // ✅ PROFILE: se è già store-shape → setProfile diretto
      if (data.profile && typeof data.profile === "object") {
        const profileToStore = looksLikeStoreProfile(data.profile)
          ? data.profile
          : mapLegacyApiProfileToStore(data.profile);

        // setProfile fa merge: se gli passi l’oggetto intero, riempi tutto quello che c’è
        setProfile(profileToStore);
      }

      // ✅ IST: (solo se hai già ist nello store — qui per ora lasciamo stare)

      // ✅ PLANNER: quando vuoi, qui importeremo il planner nello store
      // if (data.planner) importState(data.planner);

      // ✅ pulisci undo/redo (se vuoi)
      try {
        const h: any = (await import("./history")).history;
        h?.clear?.();
      } catch {}

    })();
  }, [planningId, router, setProfile, setStep, importState]);
}
