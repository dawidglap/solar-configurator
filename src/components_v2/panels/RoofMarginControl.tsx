"use client";

import React from "react";
import { nanoid } from "nanoid";

import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { getCanonicalRoofEdges } from "@/lib/planning-core/geometry-v2";
import {
  initializePerEdgeMargins,
  resolveRoofEdgeMarginM,
  resolveRoofEdgeMarginsM,
} from "@/lib/planning/roofProperties";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import NumericFieldWithSuffix from "../ui/NumericFieldWithSuffix";

const labelClass =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

function EdgeMarginField({
  roofId,
  edgeIndex,
  value,
  onCommit,
}: {
  roofId: string;
  edgeIndex: number;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [input, setInput] = React.useState(String(value));
  React.useEffect(() => setInput(String(value)), [value]);
  const reset = () => setInput(String(value));
  const commit = () => {
    const next = Number(input.replace(",", "."));
    if (!Number.isFinite(next) || next < 0 || next > 50) {
      reset();
      return;
    }
    onCommit(next);
  };
  const label = `Kante ${edgeIndex + 1}`;
  return (
    <div className="min-w-0 space-y-2">
      <label
        htmlFor={`roof-edge-margin-${roofId}-${edgeIndex}`}
        className="block truncate text-[10px] text-muted-foreground"
      >
        {label}
      </label>
      <NumericFieldWithSuffix
        id={`roof-edge-margin-${roofId}-${edgeIndex}`}
        type="text"
        inputMode="decimal"
        suffix="m"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            reset();
            event.currentTarget.blur();
          }
        }}
        data-stop-hotkeys="true"
        aria-label={`${label} Randabstand in Meter`}
      />
    </div>
  );
}

function EmptyRoofMarginControl() {
  return (
    <section className="space-y-2 border-b border-border/60 pb-4">
      <label htmlFor="roof-margin-empty" className={labelClass}>
        Randabstand
      </label>
      <NumericFieldWithSuffix
        id="roof-margin-empty"
        suffix="m"
        value=""
        placeholder="—"
        disabled
        aria-label="Randabstand in Meter – keine Dachfläche ausgewählt"
      />
    </section>
  );
}

function PopulatedRoofMarginControl({ roof }: { roof: RoofArea }) {
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const planningDraft = usePlannerV2Store((state) => state.roofPlanningDrafts[roof.id]);
  const setPlanningDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);
  const standardMarginM = usePlannerV2Store((state) => state.modules.marginM);
  const resolvedPlanning = resolveSurfacePlanning(roof.surfacePlanning);
  const advancedConfig = resolvedPlanning.status === "supported-advanced" && roof.roofKind !== "pitched"
    ? resolvedPlanning.config
    : undefined;
  const marginM = resolveRoofEdgeMarginM(roof, standardMarginM);
  const edges = getCanonicalRoofEdges(roof.points);
  const perEdgeActive = roof.edgeMarginMode === "perEdge";
  const edgeMarginsM = resolveRoofEdgeMarginsM(roof, marginM);
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

  const toggleAdvanced = () => {
    if (perEdgeActive) {
      updateRoof(roof.id, { edgeMarginMode: "global" });
      return;
    }
    updateRoof(roof.id, initializePerEdgeMargins({
      roof,
      globalMarginM: marginM,
      createId: () => `edge_${nanoid(10)}`,
    }));
  };

  const commitEdgeMargin = (edgeIndex: number, value: number) => {
    const edgeId = roof.edgeStableIds?.[edgeIndex];
    if (!edgeId) return;
    updateRoof(roof.id, {
      edgeMarginsM: { ...(roof.edgeMarginsM ?? {}), [edgeId]: value },
    });
  };

  return (
    <section className="space-y-2 border-b border-border/60 pb-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`roof-margin-${roof.id}`} className={labelClass}>
          Randabstand
        </label>
        <button
          type="button"
          onClick={toggleAdvanced}
          aria-expanded={perEdgeActive}
          className="text-[10px] font-medium text-primary/80 transition hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          {perEdgeActive ? "Standard" : "Erweitert"}
        </button>
      </div>
      {perEdgeActive && (
        <p className="text-[10px] text-muted-foreground">Erweitert aktiv</p>
      )}
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
      {perEdgeActive && edgeMarginsM && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {edges.map((edge) => (
            <EdgeMarginField
              key={roof.edgeStableIds?.[edge.edgeIndex] ?? edge.edgeIndex}
              roofId={roof.id}
              edgeIndex={edge.edgeIndex}
              value={edgeMarginsM[edge.edgeIndex] ?? marginM}
              onCommit={(value) => commitEdgeMargin(edge.edgeIndex, value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RoofMarginControl({ roof }: { roof?: RoofArea }) {
  return roof ? <PopulatedRoofMarginControl roof={roof} /> : <EmptyRoofMarginControl />;
}
