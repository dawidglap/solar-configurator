"use client";

import { useMapEvents, Rectangle } from "react-leaflet";
import { useEffect, useState } from "react";
import * as L from "leaflet";

type Props = {
  ausrichtung?: number;
  moduleSizeMeters?: [number, number]; // [altezza, larghezza]
  visible: boolean;
  resetTrigger?: boolean; // ✅ nuova prop per il reset
};

export default function SingleSolarModule({
  ausrichtung = 0,
  moduleSizeMeters = [1, 2],
  visible,
  resetTrigger,
}: Props) {
  const [modules, setModules] = useState<Array<[[number, number], [number, number]]>>([]);

  const latPerMeter = 0.000009;
  const lngPerMeter = 0.00001325;

  const moduleLat = latPerMeter * moduleSizeMeters[0]; // altezza in latitudine
  const moduleLng = lngPerMeter * moduleSizeMeters[1]; // larghezza in longitudine

  const angle = -(ausrichtung * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const rotateAround = (
    cx: number,
    cy: number,
    dx: number,
    dy: number
  ): [number, number] => {
    const rotatedLng = dx * cosA - dy * sinA + cx;
    const rotatedLat = dx * sinA + dy * cosA + cy;
    return [rotatedLat, rotatedLng];
  };

  // ✅ reset dei moduli quando cambia il trigger
  useEffect(() => {
    if (resetTrigger) {
      console.log("♻️ Resetting modules...");
      setModules([]);
    }
  }, [resetTrigger]);

  useMapEvents({
    click(e) {
      if (!visible) return;
      console.log("📍 Click su mappa", e.latlng); 

      const centerLat = e.latlng.lat;
      const centerLng = e.latlng.lng;

      const halfLat = moduleLat / 2;
      const halfLng = moduleLng / 2;

      const corner1 = rotateAround(centerLng, centerLat, -halfLng, -halfLat);
      const corner2 = rotateAround(centerLng, centerLat, halfLng, halfLat);

      setModules((prev) => [...prev, [corner1, corner2]]);
    },
  });

  if (!visible) return null;

  return (
    <>
      {modules.map((bounds, idx) => {
        const boundsObj = L.latLngBounds(
          L.latLng(bounds[0][0], bounds[0][1]),
          L.latLng(bounds[1][0], bounds[1][1])
        );

        return (
          <Rectangle
            key={idx}
            bounds={boundsObj}
            pathOptions={{
              color: "#0a192f",
              weight: 0.5,
              fillColor: "#1e293b",
              fillOpacity: 0.85,
              dashArray: "0",
              pane: "overlayPane",
            }}
          />
        );
      })}
    </>
  );
}
