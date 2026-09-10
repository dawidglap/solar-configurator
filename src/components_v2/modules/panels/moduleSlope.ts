export function imageVectorFromGeographicAzimuth(azimuthDeg: number): {
  x: number;
  y: number;
} {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

/**
 * A panel is rendered around its centre with its base on local +Y. Therefore
 * local forward/top is -Y and its geographic azimuth is numerically identical
 * to the panel's canvas rotation. Keeping this relationship local makes the
 * arrow follow committed and transient panel transforms without separate state.
 */
export function resolvePanelLocalArrowAzimuth(panelRotationCanvasDeg: number): number | undefined {
  return Number.isFinite(panelRotationCanvasDeg)
    ? normalizeAzimuth(panelRotationCanvasDeg)
    : undefined;
}
