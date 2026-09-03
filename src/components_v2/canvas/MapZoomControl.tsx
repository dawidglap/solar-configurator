"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import {
  scaleToSliderPercent,
  sliderPercentToScale,
} from "./viewportZoom";

type Props = {
  scale: number;
  fitScale: number;
  minScale: number;
  maxScale: number;
  onScaleChange: (scale: number) => void;
};

export default function MapZoomControl({
  scale,
  fitScale,
  minScale,
  maxScale,
  onScaleChange,
}: Props) {
  const frame = React.useRef<number | null>(null);
  const latest = React.useRef(scale);

  React.useEffect(() => {
    if (frame.current == null) latest.current = scale;
  }, [scale]);

  const schedule = React.useCallback((nextScale: number) => {
    latest.current = nextScale;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onScaleChange(latest.current);
    });
  }, [onScaleChange]);

  React.useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const percent = scaleToSliderPercent(scale, fitScale);

  return (
    <div
      className="fixed right-4 top-1/2 z-[590] -translate-y-1/2 rounded-xl border border-border bg-background/90 p-1.5 shadow-lg backdrop-blur-md"
      aria-label="Kartenzoom"
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onWheel={stop}
    >
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          className="glass-button-secondary grid h-7 w-7 place-items-center p-0 text-base"
          onClick={() => onScaleChange(Math.min(maxScale, scale * 1.1))}
          aria-label="Karte vergrößern"
          title="Karte vergrößern"
        >
          +
        </button>

        <div className="flex h-28 w-7 items-center justify-center overflow-visible">
          <input
            type="range"
            min={0}
            max={100}
            step={0.25}
            value={percent}
            onChange={(event) => schedule(sliderPercentToScale(Number(event.target.value), fitScale))}
            onPointerUp={() => {
              if (frame.current != null) {
                cancelAnimationFrame(frame.current);
                frame.current = null;
              }
              onScaleChange(latest.current);
            }}
            className="h-1.5 w-24 -rotate-90 accent-primary"
            aria-label="Kartenzoom"
          />
        </div>

        <button
          type="button"
          className="glass-button-secondary grid h-7 w-7 place-items-center p-0 text-base"
          onClick={() => onScaleChange(Math.max(minScale, scale / 1.1))}
          aria-label="Karte verkleinern"
          title="Karte verkleinern"
        >
          −
        </button>
        <button
          type="button"
          className="glass-button-secondary grid h-6 w-7 place-items-center p-0"
          onClick={() => onScaleChange(fitScale)}
          aria-label="Zoom zurücksetzen"
          title="Zoom zurücksetzen"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
