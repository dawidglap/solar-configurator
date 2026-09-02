"use client";

import React from "react";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import {
  resolveRoofEdgeMarginM,
  resolveRoofSlopeForKind,
  shouldShowRoofFallDirection,
} from "@/lib/planning/roofProperties";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import {
  formatRoofAzimuth,
  normalizeRoofAzimuthDeg,
  ROOF_DIRECTION_CHOICES,
  resolveRoofFallAzimuth,
} from "../roof/roofOrientation";

type Props = {
  roof: RoofArea;
  roofKind: "pitched" | "flat" | "green";
};

const inputClass = "glass-input h-8 min-w-0 flex-1 rounded-lg px-2 text-[11px]";

export default function PitchedRoofSlopeControl({ roof, roofKind }: Props) {
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const planningDraft = usePlannerV2Store((state) => state.roofPlanningDrafts[roof.id]);
  const setPlanningDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);
  const standardMarginM = usePlannerV2Store((state) => state.modules.marginM);
  const resolvedPlanning = resolveSurfacePlanning(roof.surfacePlanning);
  const advancedConfig = resolvedPlanning.status === "supported-advanced"
    ? resolvedPlanning.config
    : undefined;
  const slopeDeg = resolveRoofSlopeForKind(
    roofKind,
    advancedConfig?.surface.slopeDeg ?? roof.tiltDeg,
  );
  const resolvedAzimuth = advancedConfig?.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(roof);
  const marginM = resolveRoofEdgeMarginM(roof, standardMarginM);
  const [tiltInput, setTiltInput] = React.useState(String(slopeDeg));
  const [marginInput, setMarginInput] = React.useState(String(marginM));
  const [azimuthInput, setAzimuthInput] = React.useState(
    resolvedAzimuth == null ? "" : String(Math.round(resolvedAzimuth * 100) / 100),
  );

  React.useEffect(() => {
    setTiltInput(String(slopeDeg));
    setMarginInput(String(marginM));
    setAzimuthInput(
      resolvedAzimuth == null ? "" : String(Math.round(resolvedAzimuth * 100) / 100),
    );
  }, [marginM, resolvedAzimuth, roof.id, slopeDeg]);

  const patchAdvanced = (patch: {
    slopeDeg?: number;
    fallAzimuthDeg?: number;
    marginM?: number;
  }) => {
    if (!advancedConfig) return roof.surfacePlanning;
    return {
      ...advancedConfig,
      surface: {
        ...advancedConfig.surface,
        ...(patch.slopeDeg !== undefined ? { slopeDeg: patch.slopeDeg } : {}),
        ...(patch.fallAzimuthDeg !== undefined
          ? { fallAzimuthDeg: patch.fallAzimuthDeg }
          : {}),
      },
      advanced: {
        ...advancedConfig.advanced,
        layout: {
          ...advancedConfig.advanced.layout,
          ...(patch.marginM !== undefined ? { marginM: patch.marginM } : {}),
        },
      },
    };
  };

  const patchCurrentDraft = (patch: {
    slopeDeg?: number;
    fallAzimuthDeg?: number;
    marginM?: number;
  }) => {
    if (!planningDraft) return;
    if (planningDraft.targetMode === "standard") {
      if (patch.marginM === undefined) return;
      setPlanningDraft(roof.id, {
        ...planningDraft,
        modules: { ...planningDraft.modules, marginM: patch.marginM },
      });
      return;
    }
    const config = planningDraft.config;
    setPlanningDraft(roof.id, {
      ...planningDraft,
      config: {
        ...config,
        surface: {
          ...config.surface,
          ...(patch.slopeDeg !== undefined ? { slopeDeg: patch.slopeDeg } : {}),
          ...(patch.fallAzimuthDeg !== undefined
            ? { fallAzimuthDeg: patch.fallAzimuthDeg }
            : {}),
        },
        advanced: {
          ...config.advanced,
          layout: {
            ...config.advanced.layout,
            ...(patch.marginM !== undefined ? { marginM: patch.marginM } : {}),
          },
        },
      },
    });
  };

  const commitTilt = () => {
    if (roofKind === "flat") {
      setTiltInput("0");
      return;
    }
    const value = Number(tiltInput.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 80) {
      setTiltInput(String(slopeDeg));
      return;
    }
    updateRoof(roof.id, {
      tiltDeg: value,
      surfacePlanning: patchAdvanced({ slopeDeg: value }),
    });
    patchCurrentDraft({ slopeDeg: value });
  };

  const commitMargin = () => {
    const value = Number(marginInput.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 50) {
      setMarginInput(String(marginM));
      return;
    }
    updateRoof(roof.id, {
      edgeMarginM: value,
      surfacePlanning: patchAdvanced({ marginM: value }),
    });
    patchCurrentDraft({ marginM: value });
  };

  const commitAzimuth = (raw?: number) => {
    const candidate = raw ?? Number(azimuthInput.replace(",", "."));
    if (!Number.isFinite(candidate)) {
      setAzimuthInput(resolvedAzimuth == null ? "" : String(resolvedAzimuth));
      return;
    }
    const value = normalizeRoofAzimuthDeg(candidate);
    setAzimuthInput(String(Math.round(value * 100) / 100));
    updateRoof(roof.id, {
      fallAzimuthDeg: value,
      surfacePlanning: patchAdvanced({ fallAzimuthDeg: value }),
    });
    patchCurrentDraft({ fallAzimuthDeg: value });
  };

  const showFallDirection = shouldShowRoofFallDirection(roofKind, slopeDeg);
  const selectedPreset = ROOF_DIRECTION_CHOICES.find(
    (choice) => resolvedAzimuth != null && Math.abs(choice.azimuthDeg - resolvedAzimuth) < 0.01,
  );

  return (
    <section className="space-y-3 border-b border-border/60 pb-4">
      <label className="block space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Dachneigung
        <span className="mt-1 flex items-center gap-2 font-normal normal-case">
          <input
            type="text"
            inputMode="decimal"
            value={tiltInput}
            disabled={roofKind === "flat"}
            onChange={(event) => setTiltInput(event.target.value)}
            onBlur={commitTilt}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTiltInput(String(slopeDeg));
                event.currentTarget.blur();
              }
            }}
            className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
            data-stop-hotkeys="true"
            aria-label="Dachneigung in Grad"
          />
          <span>°</span>
        </span>
        {roofKind === "flat" && (
          <span className="mt-1 block text-[10px] font-normal normal-case text-muted-foreground">
            Flachdach · Dachneigung fest auf 0°
          </span>
        )}
      </label>

      <label className="block space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Randabstand
        <span className="mt-1 flex items-center gap-2 font-normal normal-case">
          <input
            type="text"
            inputMode="decimal"
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
            className={inputClass}
            data-stop-hotkeys="true"
            aria-label="Randabstand in Meter"
          />
          <span>m</span>
        </span>
      </label>

      {showFallDirection && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`fall-direction-${roof.id}`}
              className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Gefällerichtung
            </label>
            <strong className="text-[11px] text-primary">
              {resolvedAzimuth == null ? "Nicht festgelegt" : formatRoofAzimuth(resolvedAzimuth)}
            </strong>
          </div>
          <select
            id={`fall-direction-${roof.id}`}
            className={`${inputClass} w-full`}
            value={selectedPreset ? String(selectedPreset.azimuthDeg) : "custom"}
            onChange={(event) => {
              if (event.target.value !== "custom") commitAzimuth(Number(event.target.value));
            }}
          >
            {ROOF_DIRECTION_CHOICES.map((choice) => (
              <option key={choice.azimuthDeg} value={choice.azimuthDeg}>
                {choice.label} · {choice.azimuthDeg}°
              </option>
            ))}
            {!selectedPreset && <option value="custom">Benutzerdefiniert</option>}
          </select>
          {!selectedPreset && (
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              Exakt
              <input
                type="text"
                inputMode="decimal"
                value={azimuthInput}
                onChange={(event) => setAzimuthInput(event.target.value)}
                onBlur={() => commitAzimuth()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setAzimuthInput(resolvedAzimuth == null ? "" : String(resolvedAzimuth));
                    event.currentTarget.blur();
                  }
                }}
                className={inputClass}
                data-stop-hotkeys="true"
                aria-label="Exakte Gefällerichtung in Grad"
              />
              <span>°</span>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
