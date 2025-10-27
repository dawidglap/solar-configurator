'use client';
import React, { useId } from 'react';

type Props = {
  visible?: boolean;
  step?: number;              // distanza tra linee in px
  alpha?: number;             // 0..1
  rgb?: string;               // es. '234,88,12'
  zIndex?: number;
  className?: string;
  style?: React.CSSProperties;

  // NEW: tratteggio
  dashed?: boolean;           // se true, usa pattern SVG con dash
  dash?: string | number[];   // es. "6 6" o [6,6]
  strokeWidth?: number;       // px
};

export default function ScreenGrid({
  visible = true,
  step = 48,
  alpha = 0.02,
  rgb = '38,38,38',
  zIndex = 100,
  className,
  style,

  dashed = false,
  dash = '6 6',
  strokeWidth = 1,
}: Props) {
  if (!visible) return null;
  const rgba = `rgba(${rgb}, ${alpha})`;

  // id univoco per evitare collisioni pattern
  const rid = useId().replace(/[:]/g, '');
  const patternId = `screen-grid-${rid}`;

  if (!dashed) {
    // versione “piena” a gradienti (più performante)
    return (
      <div
        className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
        style={{
          zIndex,
          backgroundImage: `
            linear-gradient(to right, ${rgba} 1px, transparent 1px),
            linear-gradient(to bottom, ${rgba} 1px, transparent 1px)
          `,
          backgroundSize: `${step}px ${step}px`,
          backgroundPosition: '0.5px 0.5px',
          ...style,
        }}
      />
    );
  }

  // versione tratteggiata via SVG pattern
  const dashStr = Array.isArray(dash) ? dash.join(' ') : dash;

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
      style={{ zIndex, ...style }}
    >
      <svg width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <pattern
            id={patternId}
            width={step}
            height={step}
            patternUnits="userSpaceOnUse"
          >
            {/* linee posizionate a .5px per sharpness su 1px */}
            <line
              x1="0" y1="0.5" x2={step} y2="0.5"
              stroke={rgba}
              strokeWidth={strokeWidth}
              strokeDasharray={dashStr}
              shapeRendering="crispEdges"
            />
            <line
              x1="0.5" y1="0" x2="0.5" y2={step}
              stroke={rgba}
              strokeWidth={strokeWidth}
              strokeDasharray={dashStr}
              shapeRendering="crispEdges"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
