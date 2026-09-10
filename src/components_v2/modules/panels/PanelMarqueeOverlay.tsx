"use client";

import React from "react";
import { plannerTheme } from "../../theme/plannerTheme";
import type { MarqueeSelectionVisual } from "./panelMarqueeSelection";

export type PanelMarqueeOverlayHandle = {
  show: (visual: MarqueeSelectionVisual | null) => void;
};

const PanelMarqueeOverlay = React.forwardRef<PanelMarqueeOverlayHandle>(function PanelMarqueeOverlay(_, ref) {
  const [visual, setVisual] = React.useState<MarqueeSelectionVisual | null>(null);
  React.useImperativeHandle(ref, () => ({ show: setVisual }), []);
  if (!visual) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[205] h-full w-full"
      aria-hidden="true"
    >
      {visual.polygons.map((polygon, index) => (
        <polygon
          key={index}
          points={polygon.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={plannerTheme.panelSelected}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <rect
        x={visual.bounds.x}
        y={visual.bounds.y}
        width={visual.bounds.width}
        height={visual.bounds.height}
        fill="rgba(64, 217, 200, 0.08)"
        stroke={plannerTheme.primary}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});

export default PanelMarqueeOverlay;
