// src/components_v2/state/defaultStoreData.ts
// ⚠️ NO "use client" qui dentro!

import { PANEL_CATALOG } from "@/constants/panels";
import type { PlannerStep, Tool } from "@/types/planner";
import { defaultProfile } from "./slices/profileSlice";

// Se vuoi puoi tipizzare meglio, ma per ora va benissimo così.
export function defaultStoreData() {
  const selectedPanelId = PANEL_CATALOG[0]?.id ?? "";

  return {
    // step/navigation
    step: "profile" as PlannerStep,

    // view/tool
    view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
    tool: "select" as Tool,
    snapshotScale: 2 as 1 | 2 | 3,

    // progetto
    layers: [],
    zones: [],
    panels: [],
    detectedRoofs: [],

    modules: {
      orientation: "portrait",
      spacingM: 0.02,
      marginM: 0.0,
      showGrid: true,
      placingSingle: false,
      gridAngleDeg: 0,
      gridPhaseX: 0,
      gridPhaseY: 0,
      gridAnchorX: "start",
      gridAnchorY: "start",
      coverageRatio: 1,
      perRoofAngles: {},
    },

    roofAlign: { rotDeg: 0, pivotPx: undefined },

    snowGuards: [],
    selectedSnowGuardId: undefined,

    // catalog + selezione
    catalogPanels: PANEL_CATALOG,
    selectedPanelId,

    // form step 1
    profile: defaultProfile,

    // ✅ qui già “prepariamo” lo spazio per step 2 (anche se oggi non lo salvi nello store)
    // domani lo spostiamo nello store senza rompere il DB
    ist: {
      checklist: {
        inverterPhoto: false,
        meterPhoto: false,
        cabinetPhoto: false,
        lightning: false,
        internet: false,
        naProtection: false,
        evg: false,
        zev: false,
      },
      unitsCount: "",
      buildingType: "",
      roofShape: "",
      roofCover: "",
      consumption: "",
      heating: "",
      heatingCombo: false,
      hakSize: "",
      evTopic: "",
      evCar: "",
      montageTime: "",
      dismantling: "",
      dismantlingNote: "",
    },
  };
}
