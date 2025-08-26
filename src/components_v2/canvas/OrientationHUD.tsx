'use client';

import React, { useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

const TILT_FLAT_THRESHOLD = 2; // ° → consideriamo “Flachdach” se ≤ 2°

function norm360(d: number) {
  return ((d % 360) + 360) % 360;
}

function degToCardinal(az: number) {
  // 8-winds, etichette in stile internazionale (N, NE, E, SE, S, SW, W, NW)
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const i = Math.round(norm360(az) / 45) % 8;
  return dirs[i];
}

export default function OrientationHUD() {
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const roof = usePlannerV2Store(s => s.layers.find(l => l.id === selectedId));

  const info = useMemo(() => {
    if (!roof) return null;
    const tilt = typeof roof.tiltDeg === 'number' ? roof.tiltDeg : undefined;
    const az   = typeof roof.azimuthDeg === 'number' ? norm360(roof.azimuthDeg) : undefined;
    const src  = roof.source === 'sonnendach' ? 'Sonnendach' : 'Manuell';

    const flat = typeof tilt === 'number' && Math.abs(tilt) <= TILT_FLAT_THRESHOLD;

    return {
      tilt,
      az,
      flat,
      src,
      azLabel: az != null ? `${Math.round(az)}° (${degToCardinal(az)})` : '—',
      tiltLabel: flat ? 'Flachdach' : (tilt != null ? `${Number(tilt.toFixed(1))}°` : '—'),
    };
  }, [roof]);

  if (!info) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-neutral-200 bg-white/90 p-2 text-[11px] shadow-sm backdrop-blur"
      style={{ minWidth: 180 }}
    >
      <div className="flex items-center gap-2">
        {/* Mini-bussola */}
        <div className="relative h-12 w-12 shrink-0 rounded-full border border-neutral-300 bg-white">
          {/* tacche cardinali */}
          <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-neutral-300" />
          <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-neutral-300" />
          <div className="absolute left-1/2 bottom-0 h-2 w-px -translate-x-1/2 bg-neutral-300" />
          <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-neutral-300" />

          {/* freccia (nascosta se tetto piatto o azimut assente) */}
          {(!info.flat && info.az != null) && (
            <div
              className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2"
              style={{ transform: `translate(-50%, -50%) rotate(${info.az}deg)` }}
            >
              <div
                className="mx-auto"
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderBottom: '10px solid #111', // freccia
                }}
              />
            </div>
          )}
        </div>

        {/* Dati */}
        <div className="min-w-[160px] flex-1">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">Ausrichtung</span>
            <span className="font-medium text-neutral-900">{info.azLabel}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-neutral-500">Neigung</span>
            <span className="font-medium text-neutral-900">{info.tiltLabel}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-neutral-500">Quelle</span>
            <span className="text-neutral-700">{info.src}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
