import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** ---- Web Mercator helpers (EPSG:3857) ---- **/

const R = 6378137; // raggio sferoide WGS84 in metri
const MAX_LAT = 85.05112878; // limite numerico di Web Mercator

/** Converte lat/lng (gradi) -> metri (x,y) in EPSG:3857 */
export function latLngToMeters(lat: number, lng: number): { x: number; y: number } {
  // clamp lat per evitare infinito vicino ai poli
  const clampedLat = Math.max(Math.min(lat, MAX_LAT), -MAX_LAT);
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI / 180) / 2)) * R;
  return { x, y };
}

/** Converte metri (x,y) EPSG:3857 -> lat/lng (gradi) */
export function metersToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return { lat, lng };
}

/** Utility: mappa una lista di [lat,lng] -> [{x,y}] */
export function polygonLatLngToMeters(poly: [number, number][]): { x: number; y: number }[] {
  return poly.map(([lat, lng]) => latLngToMeters(lat, lng));
}

/** Utility: mappa una lista di {x,y} -> [[lat,lng]] */
export function polygonMetersToLatLng(poly: { x: number; y: number }[]): [number, number][] {
  return poly.map(({ x, y }) => {
    const { lat, lng } = metersToLatLng(x, y);
    return [lat, lng];
  });
}
