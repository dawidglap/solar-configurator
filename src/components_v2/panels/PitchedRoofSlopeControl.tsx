"use client";

import React from "react";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";
import {
  formatRoofAzimuth,
  normalizeRoofAzimuthDeg,
  ROOF_DIRECTION_CHOICES,
} from "../roof/roofOrientation";

type Props = { roof: RoofArea };

export default function PitchedRoofSlopeControl({ roof }: Props) {
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const [tiltInput, setTiltInput] = React.useState(
    roof.tiltDeg == null ? "" : String(roof.tiltDeg),
  );
  const [azimuthInput, setAzimuthInput] = React.useState(
    roof.azimuthDeg == null ? "" : String(Math.round(roof.azimuthDeg)),
  );

  React.useEffect(() => {
    setTiltInput(roof.tiltDeg == null ? "" : String(roof.tiltDeg));
    setAzimuthInput(roof.azimuthDeg == null ? "" : String(Math.round(roof.azimuthDeg)));
  }, [roof.azimuthDeg, roof.id, roof.tiltDeg]);

  const commitTilt = () => {
    const value = Number(tiltInput);
    if (!Number.isFinite(value) || value < 1 || value > 80) {
      setTiltInput(roof.tiltDeg == null ? "" : String(roof.tiltDeg));
      return;
    }
    updateRoof(roof.id, { tiltDeg: value, source: "manual" });
  };

  const commitAzimuth = (raw?: number) => {
    if (raw == null && azimuthInput.trim() === "") {
      setAzimuthInput(roof.azimuthDeg == null ? "" : String(Math.round(roof.azimuthDeg)));
      return;
    }
    const candidate = raw ?? Number(azimuthInput);
    if (!Number.isFinite(candidate)) {
      setAzimuthInput(roof.azimuthDeg == null ? "" : String(Math.round(roof.azimuthDeg)));
      return;
    }
    const value = normalizeRoofAzimuthDeg(candidate);
    setAzimuthInput(String(Math.round(value)));
    updateRoof(roof.id, { azimuthDeg: value, source: "manual" });
  };

  const currentAzimuth =
    typeof roof.azimuthDeg === "number"
      ? normalizeRoofAzimuthDeg(roof.azimuthDeg)
      : undefined;

  return (
    <section className="space-y-3 border-b border-border/60 pb-4">
      <div>
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Dachneigung
        </h3>
        <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="number"
            min={1}
            max={80}
            step={0.5}
            value={tiltInput}
            placeholder="z. B. 20"
            onChange={(event) => setTiltInput(event.target.value)}
            onBlur={commitTilt}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitTilt();
              if (event.key === "Escape") {
                setTiltInput(roof.tiltDeg == null ? "" : String(roof.tiltDeg));
              }
            }}
            className="glass-input h-8 min-w-0 flex-1 rounded-lg px-2 text-[11px]"
            aria-label="Dachneigung in Grad"
          />
          <span>°</span>
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Gefällerichtung
          </h3>
          <strong className="text-[11px] text-primary">
            {currentAzimuth == null ? "Nicht festgelegt" : formatRoofAzimuth(currentAzimuth)}
          </strong>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1" role="group" aria-label="Gefällerichtung wählen">
          {ROOF_DIRECTION_CHOICES.map((choice) => {
            const selected =
              currentAzimuth != null &&
              Math.abs(currentAzimuth - choice.azimuthDeg) < 0.5;
            return (
              <button
                key={choice.azimuthDeg}
                type="button"
                onClick={() => {
                  setAzimuthInput(String(choice.azimuthDeg));
                  commitAzimuth(choice.azimuthDeg);
                }}
                aria-pressed={selected}
                title={`${choice.azimuthDeg}° ${choice.label}`}
                className={`flex h-8 items-center justify-center gap-1 rounded-lg border text-[10px] font-semibold transition ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-muted/15 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block text-sm leading-none"
                  style={{ transform: `rotate(${choice.azimuthDeg}deg)` }}
                >
                  ↑
                </span>
                {choice.label}
              </button>
            );
          })}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          Exakt
          <input
            type="number"
            min={0}
            max={359.9}
            step={1}
            value={azimuthInput}
            placeholder="0–359"
            onChange={(event) => setAzimuthInput(event.target.value)}
            onBlur={() => commitAzimuth()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitAzimuth();
              if (event.key === "Escape") {
                setAzimuthInput(
                  currentAzimuth == null ? "" : String(Math.round(currentAzimuth)),
                );
              }
            }}
            className="glass-input h-8 min-w-0 flex-1 rounded-lg px-2 text-[11px]"
            aria-label="Exakte Gefällerichtung in Grad"
          />
          <span>°</span>
        </label>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          Die Pfeile auf der Dachfläche zeigen die Fallrichtung: 0° Nord, 90° Ost, 180° Süd, 270° West.
        </p>
      </div>
    </section>
  );
}
