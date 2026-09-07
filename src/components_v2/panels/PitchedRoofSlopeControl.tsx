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
import NumericFieldWithSuffix from "../ui/NumericFieldWithSuffix";
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

const controlClass =
  "glass-input h-9 w-full rounded-lg px-3 py-0 text-[11px] leading-none focus:ring-1 focus:ring-primary/40";
const labelClass =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

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

  const formattedResolvedAzimuth = resolvedAzimuth == null
    ? "Nicht festgelegt"
    : formatRoofAzimuth(resolvedAzimuth).replace("° ", "° · ");

  return (
    <section className="space-y-6 border-b border-border/60 pb-5">
      <div className="space-y-2">
        <label htmlFor={`roof-slope-${roof.id}`} className={labelClass}>
          Dachneigung
        </label>
        <NumericFieldWithSuffix
          id={`roof-slope-${roof.id}`}
          type="text"
          inputMode="decimal"
          suffix="°"
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
          className="disabled:cursor-not-allowed disabled:opacity-60"
          data-stop-hotkeys="true"
          aria-label="Dachneigung in Grad"
        />
        {roofKind === "flat" && (
          <p className="text-[10px] text-muted-foreground">
            Flachdach · Dachneigung fest auf 0°
          </p>
        )}
      </div>

      <div className="space-y-2">
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
      </div>

      {showFallDirection && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`fall-direction-${roof.id}`}
                className={labelClass}
              >
                Gefällerichtung
              </label>
              <strong className="shrink-0 text-[11px] font-semibold text-primary">
                {formattedResolvedAzimuth}
              </strong>
            </div>
            <select
              id={`fall-direction-${roof.id}`}
              className={controlClass}
              value={selectedPreset ? String(selectedPreset.azimuthDeg) : "custom"}
              onChange={(event) => {
                if (event.target.value !== "custom") {
                  commitAzimuth(Number(event.target.value));
                }
              }}
            >
              {ROOF_DIRECTION_CHOICES.map((choice) => (
                <option key={choice.azimuthDeg} value={choice.azimuthDeg}>
                  {choice.label} · {choice.azimuthDeg}°
                </option>
              ))}
              {!selectedPreset && <option value="custom">Benutzerdefiniert</option>}
            </select>
          </div>
          {!selectedPreset && (
            <div className="space-y-2">
              <label
                htmlFor={`exact-fall-direction-${roof.id}`}
                className={labelClass}
              >
                Exakter Winkel
              </label>
              <NumericFieldWithSuffix
                id={`exact-fall-direction-${roof.id}`}
                type="text"
                inputMode="decimal"
                suffix="°"
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
                data-stop-hotkeys="true"
                aria-label="Exakte Gefällerichtung in Grad"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
