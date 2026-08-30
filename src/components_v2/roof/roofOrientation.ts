export function normalizeRoofAzimuthDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function roofAzimuthCardinal(value: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(normalizeRoofAzimuthDeg(value) / 45) % labels.length];
}

export function formatRoofAzimuth(value: number): string {
  const normalized = normalizeRoofAzimuthDeg(value);
  return `${Math.round(normalized)}° ${roofAzimuthCardinal(normalized)}`;
}

export const ROOF_DIRECTION_CHOICES = [
  { azimuthDeg: 0, label: "N" },
  { azimuthDeg: 45, label: "NE" },
  { azimuthDeg: 90, label: "E" },
  { azimuthDeg: 135, label: "SE" },
  { azimuthDeg: 180, label: "S" },
  { azimuthDeg: 225, label: "SW" },
  { azimuthDeg: 270, label: "W" },
  { azimuthDeg: 315, label: "NW" },
] as const;
