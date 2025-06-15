"use client";

import { useEffect, useState } from "react";
import { Rectangle, useMap } from "react-leaflet";
import L from "leaflet";

type Props = {
  polygonCoords?: number[][];
  ausrichtung?: number;
  moduleSizeMeters?: [number, number];
  fillMode?: boolean;
  visible: boolean;
   mode?: string;
};

export default function SolarModulesPlacer({
  polygonCoords = [],
  ausrichtung = 0,
  moduleSizeMeters = [1, 2],
  fillMode = true,
  visible,
}: Props) {
  const map = useMap(); //eslint-disable-line @typescript-eslint/no-unused-vars
  const [modules, setModules] = useState<Array<[[number, number], [number, number]]>>([]);


  useEffect(() => {
    if (!visible || !fillMode || polygonCoords.length === 0) return;

    const bounds = L.latLngBounds(polygonCoords.map(([lat, lng]) => L.latLng(lat, lng)));
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const latPerMeter = 0.000009;
    const lngPerMeter = 0.00001325;

    const spacingLat = latPerMeter * 0.2; // 20 cm tra le righe
    const spacingLng = lngPerMeter * 0.2; // 20 cm tra le colonne

    const marginLat = latPerMeter * 2; // 2m top/bottom
    const marginLng = lngPerMeter * 2; // 2m left/right

    const moduleLat = latPerMeter * moduleSizeMeters[0]; // altezza
    const moduleLng = lngPerMeter * moduleSizeMeters[1]; // larghezza

    const stepLat = moduleLat + spacingLat;
    const stepLng = moduleLng + spacingLng;

    const angle = -(ausrichtung * Math.PI / 180);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const cx = (sw.lng + ne.lng) / 2;
    const cy = (sw.lat + ne.lat) / 2;

    const rotate = (lng: number, lat: number): [number, number] => {
      const dx = lng - cx;
      const dy = lat - cy;
      const rotatedLng = dx * cosA - dy * sinA + cx;
      const rotatedLat = dx * sinA + dy * cosA + cy;
      return [rotatedLat, rotatedLng];
    };

    const newModules: Array<[[number, number], [number, number]]> = [];


    for (
      let lat = sw.lat + marginLat;
      lat + moduleLat < ne.lat - marginLat;
      lat += stepLat
    ) {
      for (
        let lng = sw.lng + marginLng;
        lng + moduleLng < ne.lng - marginLng;
        lng += stepLng
      ) {
        const corner1 = rotate(lng, lat);
        const corner2 = rotate(lng + moduleLng, lat + moduleLat);
        newModules.push([corner1, corner2]);
      }
    }

    setModules(newModules);
  }, [polygonCoords, ausrichtung, fillMode, visible, moduleSizeMeters]);

  if (!visible) return null;

  return (
    <>
      {modules.map((bounds, idx) => (
       <Rectangle
  key={idx}
  bounds={bounds as [[number, number], [number, number]]}
  pathOptions={{
    color: "#0a192f",           // bordo blu notte
    weight: 0.5,                // bordo sottile
    fillColor: "#1e293b",       // riempimento grigio-blu (antracite)
    fillOpacity: 0.85,          // opaco, effetto solido
    dashArray: "0",             // rimuove tratteggio
    pane: "overlayPane"         // livello sopra la mappa
  }}
/>

      ))}
    </>
  );
}
