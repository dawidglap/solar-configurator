"use client";

import { useMemo, useEffect } from "react";
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
  exclusions?: [number, number][][];    // ⬅️ nuovo: poligoni di esclusione (lat,lng)
  onStats?: (s: { count: number; areaPlan: number }) => void; // già usato in Map
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
  exclusions = [],                      // ⬅️ default vuoto
  onStats,
}: Props) {
  useMap(); // per rimanere nel contesto mappa

  const { modules, areaPlanPerPanel } = useMemo(() => {
    if (!visible || !fillMode || polygonCoords.length === 0) {
      return { modules: [] as Array<[number, number][]>, areaPlanPerPanel: 0 };
    }

    // --- 1) Falda in METRI (EPSG:3857) ---
    const polyM = polygonCoords.map(([lat, lng]) => latLngToMeters(lat, lng));
    const centerLat =
      polygonCoords.reduce((s, [lat]) => s + lat, 0) / polygonCoords.length;
    const cosPhi = Math.cos((centerLat * Math.PI) / 180);
    const scale = 1 / Math.max(cosPhi, 1e-8); // sec(phi)

    // --- 2) Rotazione secondo ausrichtung ---
    const theta = (ausrichtung * Math.PI) / 180;
    const cx = polyM.reduce((s, p) => s + p.x, 0) / polyM.length;
    const cy = polyM.reduce((s, p) => s + p.y, 0) / polyM.length;
    const rot = (x: number, y: number, ang: number) => {
      const dx = x - cx, dy = y - cy;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
    };

    // Falda ruotata nel frame del tetto
    const polyR = polyM.map((p) => rot(p.x, p.y, -theta));

    const xs = polyR.map((p) => p.x), ys = polyR.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // --- 3) Helper geometrici (frame ruotato) ---
    type Pt = { x: number; y: number };
    const edgesR: Array<[Pt, Pt]> = [];
    for (let i = 0; i < polyR.length; i++) {
      edgesR.push([polyR[i], polyR[(i + 1) % polyR.length]]);
    }
    const pointInPolyGeneric = (pt: Pt, poly: Pt[]) => {
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
    const pointInPolyR = (pt: Pt) => pointInPolyGeneric(pt, polyR);

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

    // --- 3b) Esclusioni trasformate nel frame ruotato del tetto ---
    const exclusionsR: Pt[][] = exclusions.map((poly) => {
      const inMeters = poly.map(([lat, lng]) => latLngToMeters(lat, lng));
      return inMeters.map((p) => rot(p.x, p.y, -theta));
    });

    const snapM = (v: number) => Math.round(v * 100) / 100; // 1 cm in metri

    // --- 4) Dimensioni modulo in PIANTA (tilt-aware) ---
    const Hsurf = orientation === "portrait" ? moduleSizeMeters[0] : moduleSizeMeters[1];
    const Wsurf = orientation === "portrait" ? moduleSizeMeters[1] : moduleSizeMeters[0];
    const cosTilt = Math.cos(Math.max(0, Math.min(90, neigung)) * Math.PI / 180);
    const Hplan_ground = Hsurf * cosTilt; // proiezione lungo pendenza
    const Wplan_ground = Wsurf;           // ortogonale invariante

    const modH = Hplan_ground * scale;
    const modW = Wplan_ground * scale;
    const stepX = modW + spacingMeters * scale;
    const stepY = modH + spacingMeters * scale;
    const marginMap = marginMeters * scale;

    // --- 5) Griglia "da gronda": ancorata ai margini ---
    const x0 = minX + marginMap;
    const y0 = minY + marginMap;
    const xMax = maxX - marginMap;
    const yMax = maxY - marginMap;

    const candidate: Array<[number, number][]> = [];

    for (let y = y0; y + modH <= yMax + 1e-6; y += stepY) {
      for (let x = x0; x + modW <= xMax + 1e-6; x += stepX) {
        // 4 angoli (frame ruotato)
        const p1 = { x,          y          };
        const p2 = { x: x + modW, y          };
        const p3 = { x: x + modW, y: y + modH };
        const p4 = { x,          y: y + modH };

        // Dentro falda + margini
        if (!pointInPolyR(p1) || !pointInPolyR(p2) || !pointInPolyR(p3) || !pointInPolyR(p4)) continue;
        if (!minDistToEdgesOKR(p1, marginMap) || !minDistToEdgesOKR(p2, marginMap) ||
            !minDistToEdgesOKR(p3, marginMap) || !minDistToEdgesOKR(p4, marginMap)) continue;

        // ⬇️ NUOVO: blocco su zone escluse (test sul CENTRO del modulo)
        const center: Pt = { x: x + modW / 2, y: y + modH / 2 };
        const hitExclusion = exclusionsR.some((poly) => pointInPolyGeneric(center, poly));
        if (hitExclusion) continue;

        // Torna al frame mappa per disegnare
        const q1 = rot(p1.x, p1.y, +theta);
        const q2 = rot(p2.x, p2.y, +theta);
        const q3 = rot(p3.x, p3.y, +theta);
        const q4 = rot(p4.x, p4.y, +theta);

        const ll1 = metersToLatLng(snapM(q1.x), snapM(q1.y));
        const ll2 = metersToLatLng(snapM(q2.x), snapM(q2.y));
        const ll3 = metersToLatLng(snapM(q3.x), snapM(q3.y));
        const ll4 = metersToLatLng(snapM(q4.x), snapM(q4.y));

        candidate.push([
          [ll1.lat, ll1.lng],
          [ll2.lat, ll2.lng],
          [ll3.lat, ll3.lng],
          [ll4.lat, ll4.lng],
          [ll1.lat, ll1.lng],
        ]);
      }
    }

    const areaPlanPerPanel = Hplan_ground * Wplan_ground;

    // log sintetico
    // eslint-disable-next-line no-console
    console.log(
      `[PLACER] used angle=${ausrichtung}°, tilt=${neigung}° | count=${candidate.length} | ` +
      `panelAreas sloped=${(Hsurf*Wsurf).toFixed(3)} m² plan=${areaPlanPerPanel.toFixed(3)} m² | ` +
      `totalPlan=${(candidate.length*areaPlanPerPanel).toFixed(1)} m²`
    );

    return { modules: candidate, areaPlanPerPanel };
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
    exclusions, // ⬅️ fa ricomputare se cambiano le zone escluse
  ]);

  // invia stats al Map (se usato)
  useEffect(() => {
    onStats?.({
      count: modules.length,
      areaPlan: modules.length * areaPlanPerPanel,
    });
  }, [modules.length, areaPlanPerPanel, onStats]);

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
