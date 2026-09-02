export function imageVectorFromGeographicAzimuth(azimuthDeg: number): {
  x: number;
  y: number;
} {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}
