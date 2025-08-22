"use client";

import { useMemo } from "react";
import { Polygon as LPolygon, useMap } from "react-leaflet";
import { latLngToMeters, metersToLatLng } from "@/lib/utils";

type Orientation = "portrait" | "landscape";

type Props = {
  polygonCoords?: [number, number][];
  ausrichtung?: number;                 // gradi Sonnendach (-180..180)
  neigung?: number;                     // gradi Sonnendach (0..90)
  moduleSizeMeters?: [number, number];  // [H,Y ; W,X] (portrait)
  marginMeters?: number;
  spacingMeters?: number;
  fillMode?: boolean;
  visible: boolean;
  orientation?: Orientation;
  exclusions?: [number, number][][];    // eventuali esclusioni rettangolari/poligonali
  placementArea?: [number, number][] | null; // ⬅️ NUOVO: area disegnata dove posare
  onStats?: (s: { count: number; areaPlan: number }) => void;
};

export default function SolarModulesPlacer({
  polygonCoords = [],
  ausrichtung = 0,
  neigung = 0,
  moduleSizeMeters = [1.722, 1.134], // 400 W portrait
  marginMeters = 0.30,
  spacingMeters = 0.02,
  fillMode = true,
  visible,
  orientation = "portrait",
  exclusions = [],
  placementArea = null,
  onStats,
}: Props) {
  useMap();

  const modules = useMemo(() => {
    if (!visible || !fillMode || polygonCoords.length === 0) return [];

    // Se richiedi posa per area disegnata, non posare finché non c'è l'area
    if (placementArea && placementArea.length < 3) return [];

    // --- 1) Falda in METRI (EPSG:3857) ---
    const polyM = polygonCoords.map(([lat, lng]) => latLngToMeters(lat, lng));
    const centerLat =
      polygonCoords.reduce((s, [lat]) => s + lat, 0) / polygonCoords.length;
    const cosPhi = Math.cos((centerLat * Math.PI) / 180);
    const scale = 1 / Math.max(cosPhi, 1e-8); // sec(phi)

    // --- 2) Rotazione secondo ausrichtung (allineo l’asse Y alla pendenza falda) ---
    const theta = (ausrichtung * Math.PI) / 180;
    const cx = polyM.reduce((s, p) => s + p.x, 0) / polyM.length;
    const cy = polyM.reduce((s, p) => s + p.y, 0) / polyM.length;
    const rot = (x: number, y: number, ang: number) => {
      const dx = x - cx, dy = y - cy;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
    };

    const polyR = polyM.map((p) => rot(p.x, p.y, -theta));

    // --- (opzionale) Placement area in frame ruotato ---
    let placeR: { x: number; y: number }[] | null = null;
    if (placementArea) {
      const placeM = placementArea.map(([lat, lng]) => latLngToMeters(lat, lng));
      placeR = placeM.map((p) => rot(p.x, p.y, -theta));
    }

    // --- 3) Helper geometrici ---
    type Pt = { x: number; y: number };

    const rayInPoly = (pt: Pt, poly: Pt[]) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const inter =
          yi > pt.y !== yj > pt.y &&
          pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
        if (inter) inside = !inside;
      }
      return inside;
    };

    const edgesR: Array<[Pt, Pt]> = [];
    for (let i = 0; i < polyR.length; i++) edgesR.push([polyR[i], polyR[(i + 1) % polyR.length]]);

    const dist2PointToSeg = (p: Pt, a: Pt, b: Pt) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const wx = p.x - a.x, wy = p.y - a.y;
      const c1 = vx * wx + vy * wy;
      if (c1 <= 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      const c2 = vx * vx + vy * vy;
      if (c2 <= c1) return (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
      const t = c1 / c2;
      const px = a.x + t * vx, py = a.y + t * vy;
      return (p.x - px) ** 2 + (p.y - py) ** 2;
    };

    const minDistToEdgesOKR = (p: Pt, minDist: number) => {
      const th2 = minDist * minDist;
      for (const [a, b] of edgesR) if (dist2PointToSeg(p, a, b) < th2) return false;
      return true;
    };

    const snapM = (v: number) => Math.round(v * 100) / 100; // 1 cm

    // --- 4) Dimensioni modulo in pianta (tilt-aware) ---
    const Hsurf = orientation === "portrait" ? moduleSizeMeters[0] : moduleSizeMeters[1];
    const Wsurf = orientation === "portrait" ? moduleSizeMeters[1] : moduleSizeMeters[0];
    const cosTilt = Math.cos(Math.max(0, Math.min(90, neigung)) * Math.PI / 180);
    const Hplan_ground = Hsurf * cosTilt;
    const Wplan_ground = Wsurf;

    const modH = Hplan_ground * scale;
    const modW = Wplan_ground * scale;
    const stepX = modW + spacingMeters * scale;
    const stepY = modH + spacingMeters * scale;
    const marginMap = marginMeters * scale;

    // BBOX falda ruotata
    const xs = polyR.map((p) => p.x), ys = polyR.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // --- 5) Griglia ancorata ai margini falda ---
    const x0 = minX + marginMap;
    const y0 = minY + marginMap;
    const xMax = maxX - marginMap;
    const yMax = maxY - marginMap;

    const panels: Array<[number, number][]> = [];

    for (let y = y0; y + modH <= yMax + 1e-6; y += stepY) {
      for (let x = x0; x + modW <= xMax + 1e-6; x += stepX) {
        const p1 = { x,          y          };
        const p2 = { x: x + modW, y          };
        const p3 = { x: x + modW, y: y + modH };
        const p4 = { x,          y: y + modH };

        // dentro falda + margine dai bordi falda
        if (!rayInPoly(p1, polyR) || !rayInPoly(p2, polyR) || !rayInPoly(p3, polyR) || !rayInPoly(p4, polyR)) continue;
        if (!minDistToEdgesOKR(p1, marginMap) || !minDistToEdgesOKR(p2, marginMap) ||
            !minDistToEdgesOKR(p3, marginMap) || !minDistToEdgesOKR(p4, marginMap)) continue;

        // dentro area di posa (se presente)
        if (placeR) {
          if (!rayInPoly(p1, placeR) || !rayInPoly(p2, placeR) || !rayInPoly(p3, placeR) || !rayInPoly(p4, placeR)) continue;
        }

        // esclusioni (in lat/lng → semplificazione: testiamo dopo rotazione inversa)
        // (Se già gestite a monte, puoi omettere; altrimenti mantieni questo TODO)

        // ruota indietro in mappa e converti in lat/lng
        const q1 = rot(p1.x, p1.y, +theta);
        const q2 = rot(p2.x, p2.y, +theta);
        const q3 = rot(p3.x, p3.y, +theta);
        const q4 = rot(p4.x, p4.y, +theta);

        const ll1 = metersToLatLng(snapM(q1.x), snapM(q1.y));
        const ll2 = metersToLatLng(snapM(q2.x), snapM(q2.y));
        const ll3 = metersToLatLng(snapM(q3.x), snapM(q3.y));
        const ll4 = metersToLatLng(snapM(q4.x), snapM(q4.y));

        panels.push([
          [ll1.lat, ll1.lng],
          [ll2.lat, ll2.lng],
          [ll3.lat, ll3.lng],
          [ll4.lat, ll4.lng],
          [ll1.lat, ll1.lng],
        ]);
      }
    }

    const areaSlopedPerPanel = Hsurf * Wsurf;
    const areaPlanPerPanel   = Hplan_ground * Wplan_ground;
    onStats?.({ count: panels.length, areaPlan: Number((panels.length * areaPlanPerPanel).toFixed(2)) });

    // eslint-disable-next-line no-console
    console.log(
      `[PLACER] used angle=${ausrichtung}°, tilt=${neigung}° | count=${panels.length} | ` +
      `panelAreas sloped=${areaSlopedPerPanel.toFixed(3)} m² plan=${areaPlanPerPanel.toFixed(3)} m² | ` +
      `totalPlan=${(panels.length*areaPlanPerPanel).toFixed(1)} m²`
    );

    return panels;
  }, [
    polygonCoords,
    ausrichtung,
    neigung,
    moduleSizeMeters,
    marginMeters,
    spacingMeters,
    fillMode,
    visible,
    orientation,
    exclusions,
    placementArea,
    onStats,
  ]);

  if (!visible || modules.length === 0) return null;

  return (
    <>
      {modules.map((poly, idx) => (
        <LPolygon
          key={idx}
          positions={poly as [number, number][]}
          smoothFactor={0}
          pathOptions={{
            color: "#0a192f",
            weight: 0.5,
            fillColor: "#1e293b",
            fillOpacity: 0.85,
            lineJoin: "miter",
            lineCap: "butt",
          }}
        />
      ))}
    </>
  );
}
