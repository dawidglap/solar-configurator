'use client';

import React, { useMemo } from 'react';
import { usePlannerV2Store } from './state/plannerV2Store';

type Props = {
  /** Drehung des Orientierungs-HUD (°), 0 = Rohbild */
  rotateDeg: number;
};

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10); // alle 10°

function normDeg(d: number) {
  let a = d % 360;
  if (a < 0) a += 360;
  return a;
}

function dirLabel(deg: number) {
  const a = normDeg(deg);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(a / 45) % 8;
  return dirs[idx];
}

export default function CompassHUD({ rotateDeg }: Props) {
  const layers = usePlannerV2Store((s) => s.layers);
  const selectedId = usePlannerV2Store((s) => s.selectedId);

  const roof = layers.find((l) => l.id === selectedId);
  const roofAzimuthDeg = roof?.azimuthDeg ?? 0;

  // Orientierung des Dachs = tatsächlicher Dachazimut + HUD-Rotation
  const roofDirectionDeg = useMemo(
    () => normDeg(roofAzimuthDeg + rotateDeg),
    [roofAzimuthDeg, rotateDeg]
  );

  const label = dirLabel(roofDirectionDeg);

  return (
    <div className="fixed right-3 top-24 z-[260] pointer-events-none">
      <div
        className="
          pointer-events-auto flex flex-col items-center gap-1.5
          rounded-2xl border border-neutral-700/70 bg-black/80 text-neutral-100
          px-3 py-2 shadow-lg backdrop-blur-sm
        "
      >
        {/* Kompass-Kreis */}
        <div className="relative w-28 h-28 rounded-full border border-neutral-600 bg-neutral-900">
          {/* Striche */}
          {TICKS.map((deg) => {
            const isCardinal = deg % 90 === 0;
            return (
              <div
                key={deg}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: `rotate(${deg}deg) translateY(-48%)`,
                  transformOrigin: 'center',
                }}
              >
                <div
                  className={
                    isCardinal
                      ? 'w-[1.5px] h-3 bg-neutral-200'
                      : 'w-[1px] h-2 bg-neutral-600/80'
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

          {/* GRÜNER Pfeil = Dachausrichtung */}
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              transform: `translate(-50%, -50%) rotate(${roofDirectionDeg}deg)`,
              transformOrigin: 'center',
            }}
          >
            {/* Schaft */}
            <div className="w-[3px] h-10 rounded-full bg-emerald-400/90 shadow-[0_0_8px_rgba(16,185,129,0.7)] mx-auto" />
            {/* Spitze */}
            <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[7px] border-l-transparent border-r-transparent border-b-emerald-400 mx-auto -mt-1" />
          </div>

          {/* kleiner Kreis in der Mitte */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-neutral-900/95 border border-neutral-700/70" />
        </div>

        {/* numerische Anzeige z.B. „268° W“ */}
        <div className="text-[11px] leading-none tracking-wide tabular-nums">
          {Math.round(roofDirectionDeg)}° {label}
        </div>

        {/* Legende Nord vs Dach */}
        <div className="flex items-center gap-3 text-[9px] text-neutral-400 leading-tight">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-[2px] bg-red-500" />
            Nord
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-[2px] bg-emerald-400" />
            Dach
          </span>
        </div>

        <div className="text-[9px] text-neutral-500">
          Dachausrichtung relativ zu Nord
        </div>
      </div>
    </div>
  );
}
