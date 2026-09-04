"use client";

import React from "react";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import type { ThermalFieldDisplayInput } from "../thermalFields/thermalFieldDisplay";
import {
  buildCommittedStandardThermalFieldMeasurements,
  buildCommittedThermalFieldMeasurements,
} from "./committedMontageFieldMeasurements";

export default function CommittedMontageFieldDimensionsLayer({
  onThermalFieldsChange,
}: {
  onThermalFieldsChange?: (roofId: string, fields: ThermalFieldDisplayInput[]) => void;
}) {
  const show = usePlannerV2Store((state) => state.ui.showFieldDimensions);
  const step = usePlannerV2Store((state) => state.step);
  const selectedId = usePlannerV2Store((state) => state.selectedId);
  const roof = usePlannerV2Store((state) =>
    state.layers.find((candidate) => candidate.id === state.selectedId),
  );
  const draft = usePlannerV2Store((state) =>
    state.selectedId ? state.roofPlanningDrafts[state.selectedId] : undefined,
  );
  const panels = usePlannerV2Store((state) => state.panels);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const persisted = React.useMemo(
    () => resolveSurfacePlanning(roof?.surfacePlanning),
    [roof?.surfacePlanning],
  );
  const thermalFields = React.useMemo(
    () =>
      show && step === "modules" && selectedId && roof && !draft && mppImage
        ? persisted.status === "supported-advanced"
          ? buildCommittedThermalFieldMeasurements({
              roof,
              config: persisted.config,
              panels,
              mppImage,
            })
          : persisted.status === "supported-standard"
            ? buildCommittedStandardThermalFieldMeasurements({ roof, panels, mppImage })
            : []
        : [],
    [draft, mppImage, panels, persisted, roof, selectedId, show, step],
  );
  const displayInputs = React.useMemo<ThermalFieldDisplayInput[]>(() => {
    if (!show || !roof || !thermalFields.length) return [];
    const limits = persisted.status === "supported-advanced" || persisted.status === "supported-standard"
      ? persisted.config.thermalFieldLimits
      : undefined;
    if (!limits) return [];
    return thermalFields.map((field) => ({
      key: field.thermalFieldKey,
      outlinePx: field.outlinePx,
      lengthM: field.longSideSizeM,
      widthM: field.railSizeM,
      moduleCount: field.moduleCount,
      ...(persisted.status === "supported-advanced" ? { blockCount: field.blockCount } : {}),
      ...(limits.kind === "flat-block" && limits.maxModuleLongSideDirectionM === undefined
        ? {}
        : { lengthLimitM: limits.kind === "flat-block"
          ? limits.maxModuleLongSideDirectionM
          : limits.maxRowDirectionM }),
      widthLimitM: limits.kind === "flat-block"
        ? limits.maxRailDirectionM
        : limits.maxColumnDirectionM,
      valid:
        field.railSizeM <= (limits.kind === "flat-block" ? limits.maxRailDirectionM : limits.maxColumnDirectionM) + 1e-9 &&
        (limits.kind === "flat-block" && limits.maxModuleLongSideDirectionM === undefined
          ? true
          : field.longSideSizeM <= (limits.kind === "flat-block" ? limits.maxModuleLongSideDirectionM! : limits.maxRowDirectionM) + 1e-9),
    }));
  }, [persisted, roof, show, thermalFields]);
  React.useEffect(() => {
    if (!roof) return;
    onThermalFieldsChange?.(roof.id, displayInputs);
    return () => onThermalFieldsChange?.(roof.id, []);
  }, [displayInputs, onThermalFieldsChange, roof]);

  return null;
}
