"use client";

import React from "react";
import { usePlannerV2Store } from "./state/plannerV2Store";
import { resolveRoofFallAzimuth, roofAzimuthCardinal } from "./roof/roofOrientation";
import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10); // alle 10°

export default function CompassHUD() {
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const draft = usePlannerV2Store((s) =>
    s.selectedId ? s.roofPlanningDrafts[s.selectedId] : undefined,
  );

  const roof = layers.find((l) => l.id === selectedId);
  if (!roof) return null;
  const persistedPlanning = resolveSurfacePlanning(roof.surfacePlanning);
  const advancedConfig: AdvancedSurfacePlanningV1 | undefined =
    draft?.targetMode === "advanced"
      ? draft.config
      : persistedPlanning.status === "supported-advanced"
        ? persistedPlanning.config
        : undefined;
  const isFlat = advancedConfig?.surface.kind === "flat";
  const system = advancedConfig?.advanced.system;
  const primaryModuleAzimuthDeg = system?.systemId === K2_S_DOME_SYSTEM_ID ||
      system?.systemId === GENERIC_SOUTH_SYSTEM_ID
    ? system.faceAzimuthDeg
    : system?.systemId === K2_D_DOME_SYSTEM_ID ||
        system?.systemId === GENERIC_EAST_WEST_SYSTEM_ID
      ? system.primaryFaceAzimuthDeg
      : undefined;
  const opposingModules = system?.systemId === K2_D_DOME_SYSTEM_ID ||
    system?.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  const primaryDirectionDeg = isFlat
    ? primaryModuleAzimuthDeg
    : resolveRoofFallAzimuth(roof);
  if (primaryDirectionDeg == null) return null;
  const directionDegs = opposingModules && isFlat
    ? [primaryDirectionDeg, (primaryDirectionDeg + 180) % 360]
    : [primaryDirectionDeg];
  const numericLabel = directionDegs
    .map((direction) => `${Math.round(direction)}° ${roofAzimuthCardinal(direction)}`)
    .join(" / ");

  return (
    <div className="fixed right-3 top-24 z-[260] pointer-events-none mt-4">
      <div
        className="
          pointer-events-auto flex flex-col items-center gap-1.5
          rounded-2xl border border-neutral-700/70 bg-[#262626] opacity-80 text-neutral-100
          px-3 py-2 shadow-lg backdrop-blur-sm
        "
      >
        {/* Kompass-Kreis */}
        <div className="relative w-28 h-28 rounded-full border border-neutral-600  bg-neutral-900">
          {/* Striche */}
          {TICKS.map((deg) => {
            const isCardinal = deg % 90 === 0;
            return (
              <div
                key={deg}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: `rotate(${deg}deg) translateY(-48%)`,
                  transformOrigin: "center",
                }}
              >
                <div
                  className={
                    isCardinal
                      ? "w-[1.5px] h-3 bg-neutral-200"
                      : "w-[1px] h-2 bg-neutral-600/80"
                  }
                />
              </div>
            );
          })}

          {/* Himmelsrichtungen */}
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-red-400">
            N
          </span>
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold">
            E
          </span>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold">
            S
          </span>
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold">
            W
          </span>

          {/* ROTE Linie = absoluter Norden */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-[2px] h-10 rounded-full bg-red-500/90" />
          </div>

          {directionDegs.map((directionDeg) => (
            <div
              key={directionDeg}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) rotate(${directionDeg}deg)`,
                transformOrigin: "center",
              }}
            >
              <div className="mx-auto h-10 w-[3px] rounded-full bg-emerald-400/90 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              <div className="mx-auto -mt-1 h-0 w-0 border-b-[7px] border-l-[5px] border-r-[5px] border-b-emerald-400 border-l-transparent border-r-transparent" />
            </div>
          ))}

          {/* kleiner Kreis in der Mitte */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-neutral-900/95 border border-neutral-700/70" />
        </div>

        {/* numerische Anzeige z.B. „268° W“ */}
        <div className="text-[11px] leading-none tracking-wide tabular-nums">
          {numericLabel}
        </div>

        {/* Legende Nord vs Dach */}
        <div className="flex items-center gap-3 text-[9px] text-neutral-400 leading-tight">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-[2px] bg-red-500" />
            Nord
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-[2px] bg-emerald-400" />
            {isFlat ? "Module" : "Dach"}
          </span>
        </div>

        <div className="text-[9px] text-neutral-500">
          {isFlat ? "Modulausrichtung relativ zu Nord" : "Gefällerichtung relativ zu Nord"}
        </div>
      </div>
    </div>
  );
}
