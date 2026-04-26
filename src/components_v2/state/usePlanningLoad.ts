// src/components_v2/state/usePlanningLoad.ts
"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePlannerV2Store } from "./plannerV2Store";
import { normalizePlannerStep } from "./normalizePlannerStep";
import { defaultIst } from "./slices/istSlice";
import {
  buildTiledSnapshot,
  TILE_SWISSTOPO_SAT,
} from "../utils/stitchTilesWMTS";

/** normalizza "Herr"/"Frau" -> "herr"/"frau" */
function mapSalutation(v: any): "herr" | "frau" | null {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("herr")) return "herr";
  if (s.includes("frau")) return "frau";
  return null;
}

/** fallback: vecchia shape API -> nuova shape store */
function mapLegacyApiProfileToStore(api: any) {
  const customerType = String(api?.customerKind ?? "").toLowerCase();
  const customerStatus = String(api?.customerType ?? "").toLowerCase();

  return {
    customerStatus: customerStatus === "existing" ? "existing" : "new",
    customerType:
      customerType === "firma" || customerType === "company"
        ? "company"
        : "private",
    source: api?.source ?? "",
    legalForm: api?.legalForm ?? "",

    contactSalutation: mapSalutation(api?.contact?.salutation),
    contactFirstName: api?.contact?.firstName ?? "",
    contactLastName: api?.contact?.lastName ?? "",
    contactMobile: api?.contact?.mobile ?? api?.contact?.phone ?? "",
    contactEmail: api?.contact?.email ?? "",

    buildingStreet: api?.buildingAddress?.street ?? api?.building?.street ?? "",
    buildingStreetNo:
      api?.buildingAddress?.streetNo ?? api?.building?.streetNo ?? "",
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

function looksLikeStoreProfile(p: any) {
  if (!p || typeof p !== "object") return false;
  return (
    "contactFirstName" in p ||
    "contactLastName" in p ||
    "customerStatus" in p ||
    "customerType" in p
  );
}

function buildSnapshotFromPlanning(planning: any) {
  const data = planning?.data ?? {};
  const planner = data?.planner ?? {};

  const fallbackAddress = [
    data?.profile?.buildingStreet,
    data?.profile?.buildingStreetNo,
    [data?.profile?.buildingZip, data?.profile?.buildingCity]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    url:
      planner?.snapshot?.url ??
      data?.snapshot?.url ??
      data?.snapshotUrl ??
      null,

    width:
      planner?.snapshot?.width ??
      data?.snapshot?.width ??
      data?.snapshotWidth ??
      null,

    height:
      planner?.snapshot?.height ??
      data?.snapshot?.height ??
      data?.snapshotHeight ??
      null,

    mppImage:
      planner?.snapshot?.mppImage ??
      data?.snapshot?.mppImage ??
      data?.snapshotMppImage ??
      data?.mppImage ??
      null,

    center:
      planner?.snapshot?.center ??
      data?.snapshot?.center ??
      null,

    zoom:
      planner?.snapshot?.zoom ??
      data?.snapshot?.zoom ??
      null,

    bbox3857:
      planner?.snapshot?.bbox3857 ??
      data?.snapshot?.bbox3857 ??
      null,

    address:
      planner?.snapshot?.address ??
      data?.snapshot?.address ??
      (fallbackAddress || null),
  };
}

async function rebuildSnapshotIfNeeded(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;

  // se url esiste già, non fare nulla
  if (snapshot.url) return snapshot;

  const lat = snapshot?.center?.lat;
  const lon = snapshot?.center?.lon;
  const zoom = snapshot?.zoom;
  const width = snapshot?.width;
  const height = snapshot?.height;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    typeof zoom !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return snapshot;
  }

  try {
    const rebuilt = await buildTiledSnapshot({
      lat,
      lon,
      zoom,
      width,
      height,
      scale: 1,
      tileUrl: TILE_SWISSTOPO_SAT,
      attribution: "© swisstopo",
    });

    return {
      ...snapshot,
      url: rebuilt.dataUrl,
      width: rebuilt.width,
      height: rebuilt.height,
    };
  } catch (err) {
    console.error("Failed to rebuild snapshot from saved metadata:", err);
    return snapshot;
  }
}

export function usePlanningLoad() {
  const sp = useSearchParams();
  const router = useRouter();
  const planningId = sp.get("planningId");
  const plannerStep = sp.get("plannerStep");
  const initialStep = sp.get("initialStep");
  const stepParam = sp.get("step");
  const currentStepParam = sp.get("currentStep");

  const setStep = usePlannerV2Store((s) => s.setStep);
  const resetPlanner = usePlannerV2Store((s) => s.resetPlanner);
  const setProfile = usePlannerV2Store((s) => s.setProfile);
  const setIstAll = usePlannerV2Store((s) => s.setIstAll);
  const importState = usePlannerV2Store((s) => s.importState);
  const setSnapshot = usePlannerV2Store((s) => s.setSnapshot);
  const setAddress = usePlannerV2Store((s) => (s as any).setAddress);

  useEffect(() => {
    if (!planningId) return;

    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/plannings/${planningId}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok || cancelled) return;

      const planning = json.planning;
      const data = planning?.data ?? {};
      const requestedStepFromUrl =
        normalizePlannerStep(plannerStep) ||
        normalizePlannerStep(initialStep) ||
        normalizePlannerStep(stepParam) ||
        normalizePlannerStep(currentStepParam);
      const requestedStep =
        requestedStepFromUrl ||
        normalizePlannerStep(planning?.currentStep) ||
        normalizePlannerStep(data?.step) ||
        normalizePlannerStep(data?.planner?.step) ||
        "building";

      await usePlannerV2Store.persist.clearStorage();
      resetPlanner();

      // 1) profile
      if (data.profile && typeof data.profile === "object") {
        const profileToStore = looksLikeStoreProfile(data.profile)
          ? data.profile
          : mapLegacyApiProfileToStore(data.profile);

        setProfile(profileToStore);
      }

      // 2) ist
      if (data.ist && typeof data.ist === "object") {
        setIstAll(data.ist);
      } else {
        setIstAll(defaultIst);
      }

      // 3) planner state
      if (data.planner && typeof data.planner === "object") {
        importState(data.planner);
      }

      // 4) snapshot re-hydration + rebuild image if needed
      let snapshot = buildSnapshotFromPlanning(planning);
      snapshot = await rebuildSnapshotIfNeeded(snapshot);
      // ✅ set address nello store (per searchbar)
if (snapshot?.address) {
  setAddress?.({
    label: snapshot.address,
    lat: snapshot?.center?.lat ?? null,
    lon: snapshot?.center?.lon ?? null,
  });
}

      if (
        snapshot?.url ||
        snapshot?.width ||
        snapshot?.height ||
        snapshot?.mppImage ||
        snapshot?.address
      ) {
        setSnapshot(snapshot);
      }

      // 5) URL-requested step wins over persisted planner/backend step
      setStep(requestedStep);

      // 6) clear undo/redo
      try {
        const h: any = (await import("./history")).history;
        h?.clear?.();
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [
    planningId,
    plannerStep,
    initialStep,
    stepParam,
    currentStepParam,
    router,
    setProfile,
    setIstAll,
    setStep,
    resetPlanner,
    importState,
    setSnapshot,
    setAddress,
  ]);
}
