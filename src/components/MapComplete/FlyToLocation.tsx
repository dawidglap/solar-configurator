"use client";

import { useMap } from "react-leaflet";

export default function FlyToLocation({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  map.flyTo([lat, lon], 20, {
    duration: 2,
    easeLinearity: 0.25,
  });
  return null;
}
