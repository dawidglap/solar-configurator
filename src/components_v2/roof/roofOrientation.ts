export function normalizeRoofAzimuthDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function roofAzimuthCardinal(value: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(normalizeRoofAzimuthDeg(value) / 45) % labels.length];
}

export function roofAzimuthCardinalLong(value: number): string {
  const labels = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];
  return labels[Math.round(normalizeRoofAzimuthDeg(value) / 45) % labels.length];
}

export function formatRoofSlopeDirection(slopeDeg: number, fallAzimuthDeg: number): string {
  return `${Math.round(slopeDeg)}° · ${roofAzimuthCardinalLong(fallAzimuthDeg)}`;
}

export function formatRoofAzimuth(value: number): string {
  const normalized = normalizeRoofAzimuthDeg(value);
  return `${Math.round(normalized)}° ${roofAzimuthCardinal(normalized)}`;
}

/** Converts the imported Sonnendach direction to the roof's downhill direction. */
export function sonnendachAzimuthToRoofFallDirection(value: number): number {
  return normalizeRoofAzimuthDeg(value + 180);
}

export function resolveRoofFallAzimuth(input: {
  azimuthDeg?: number;
  fallAzimuthDeg?: number;
  source?: "manual" | "sonnendach";
}): number | undefined {
  if (typeof input.fallAzimuthDeg === "number") {
    return normalizeRoofAzimuthDeg(input.fallAzimuthDeg);
  }
  if (typeof input.azimuthDeg !== "number") return undefined;
  return input.source === "sonnendach"
    ? sonnendachAzimuthToRoofFallDirection(input.azimuthDeg)
    : normalizeRoofAzimuthDeg(input.azimuthDeg);
}

export const ROOF_DIRECTION_CHOICES = [
  { azimuthDeg: 0, label: "Nord" },
  { azimuthDeg: 45, label: "Nordost" },
  { azimuthDeg: 90, label: "Ost" },
  { azimuthDeg: 135, label: "Südost" },
  { azimuthDeg: 180, label: "Süd" },
  { azimuthDeg: 225, label: "Südwest" },
  { azimuthDeg: 270, label: "West" },
  { azimuthDeg: 315, label: "Nordwest" },
] as const;
