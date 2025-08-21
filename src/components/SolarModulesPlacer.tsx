"use client";

import { useEffect, useState } from "react";
import { Rectangle, useMap } from "react-leaflet";
import {
  latLngToMeters,
  metersToLatLng,
} from "@/lib/utils";

type Props = {
  polygonCoords?: [number, number][];      // lat,lng
  ausrichtung?: number;                    // gradi (0=N)
  moduleSizeMeters?: [number, number];     // [altezza(Y), larghezza(X)] in metri
  marginMeters?: number;                   // default 0.30 m
  spacingMeters?: number;                  // default 0.02 m
  fillMode?: boolean;
  visible: boolean;
  mode?: string;
};

export default function SolarModulesPlacer({
  polygonCoords = [],
  ausrichtung = 0,
  moduleSizeMeters = [1.722, 1.134], // preset 400 W residenziale
  marginMeters = 0.30,
  spacingMeters = 0.02,
  fillMode = true,
  visible,
}: Props) {
  useMap(); // manteniamo la subscription al contesto mappa
  const [modules, setModules] = useState<Array<[[number, number], [number, number]]>>([]);

  useEffect(() => {
    if (!visible || !fillMode || polygonCoords.length === 0) return;

    // 1) Poligono -> METRI (EPSG:3857)
    const polyMeters = polygonCoords.map(([lat, lng]) => latLngToMeters(lat, lng));
    const xs = polyMeters.map((p) => p.x);
    const ys = polyMeters.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // 2) BBox interna con margine reale
    const innerMinX = minX + marginMeters;
    const innerMaxX = maxX - marginMeters;
    const innerMinY = minY + marginMeters;
    const innerMaxY = maxY - marginMeters;

    if (innerMaxX - innerMinX <= 0 || innerMaxY - innerMinY <= 0) {
      setModules([]);
      return;
    }

    // 3) Dimensione modulo e passo griglia (in metri)
    const modH = moduleSizeMeters[0]; // lungo Y
    const modW = moduleSizeMeters[1]; // lungo X
    const stepX = modW + spacingMeters;
    const stepY = modH + spacingMeters;

    // 4) Centro bbox (se in futuro ruotiamo, useremo questo pivot)
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // NB: Rectangle di Leaflet non supporta rettangoli ruotati.
    // Quindi per l’MVP manteniamo i rettangoli axis-aligned alla proiezione.
    // (La rotazione reale e il clipping al poligono arriveranno nello step 3b.3)
    // const angle = -(ausrichtung * Math.PI) / 180; // per futuro uso

    const nextModules: Array<[[number, number], [number, number]]> = [];

    for (let y = innerMinY; y + modH <= innerMaxY; y += stepY) {
      for (let x = innerMinX; x + modW <= innerMaxX; x += stepX) {
        // Rettangolo in metri (axis-aligned)
        const x2 = x + modW;
        const y2 = y + modH;

        // Converti i due angoli in lat/lng per il <Rectangle />
        const p1 = metersToLatLng(x, y);
        const p2 = metersToLatLng(x2, y2);

        nextModules.push([[p1.lat, p1.lng], [p2.lat, p2.lng]]);
      }
    }

    setModules(nextModules);
  }, [
    polygonCoords,
    ausrichtung,
    moduleSizeMeters,
    marginMeters,
    spacingMeters,
    fillMode,
    visible,
  ]);

  if (!visible) return null;

  return (
    <>
      {modules.map((bounds, idx) => (
        <Rectangle
          key={idx}
          bounds={bounds as [[number, number], [number, number]]}
          pathOptions={{
            color: "#0a192f",
            weight: 0.5,
            fillColor: "#1e293b",
            fillOpacity: 0.85,
            dashArray: "0",
            pane: "overlayPane",
          }}
        />
      ))}
    </>
  );
}
