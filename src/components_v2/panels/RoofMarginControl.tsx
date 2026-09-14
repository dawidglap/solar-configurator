"use client";

import React from "react";

import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import NumericFieldWithSuffix from "../ui/NumericFieldWithSuffix";

const labelClass =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

export default function RoofMarginControl({ roof }: { roof: RoofArea }) {
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const planningDraft = usePlannerV2Store((state) => state.roofPlanningDrafts[roof.id]);
  const setPlanningDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);
  const standardMarginM = usePlannerV2Store((state) => state.modules.marginM);
  const resolvedPlanning = resolveSurfacePlanning(roof.surfacePlanning);
  const advancedConfig = resolvedPlanning.status === "supported-advanced" && roof.roofKind !== "pitched"
    ? resolvedPlanning.config
    : undefined;
  const marginM = resolveRoofEdgeMarginM(roof, standardMarginM);
  const [marginInput, setMarginInput] = React.useState(String(marginM));

  React.useEffect(() => {
    setMarginInput(String(marginM));
  }, [marginM, roof.id]);

  const commitMargin = () => {
    const value = Number(marginInput.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 50) {
      setMarginInput(String(marginM));
      return;
    }
    updateRoof(roof.id, {
      edgeMarginM: value,
      ...(advancedConfig ? {
        surfacePlanning: {
          ...advancedConfig,
          advanced: {
            ...advancedConfig.advanced,
            layout: { ...advancedConfig.advanced.layout, marginM: value },
          },
        },
      } : {}),
    });
    if (planningDraft?.targetMode === "standard") {
      setPlanningDraft(roof.id, {
        ...planningDraft,
        modules: { ...planningDraft.modules, marginM: value },
      });
    } else if (planningDraft?.targetMode === "advanced") {
      setPlanningDraft(roof.id, {
        ...planningDraft,
        config: {
          ...planningDraft.config,
          advanced: {
            ...planningDraft.config.advanced,
            layout: { ...planningDraft.config.advanced.layout, marginM: value },
          },
        },
      });
    }
  };

  return (
    <section className="space-y-2 border-b border-border/60 pb-4">
      <label htmlFor={`roof-margin-${roof.id}`} className={labelClass}>
        Randabstand
      </label>
      <NumericFieldWithSuffix
        id={`roof-margin-${roof.id}`}
        type="text"
        inputMode="decimal"
        suffix="m"
        value={marginInput}
        onChange={(event) => setMarginInput(event.target.value)}
        onBlur={commitMargin}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setMarginInput(String(marginM));
            event.currentTarget.blur();
          }
        }}
        data-stop-hotkeys="true"
        aria-label="Randabstand in Meter"
      />
    </section>
  );
}
