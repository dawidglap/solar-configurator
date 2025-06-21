// /components/MapComplete/RoofPolygons.tsx
"use client";

import { Polygon } from "react-leaflet";
import { RoofPolygon } from "@/types/roof";
import { LatLngTuple } from "leaflet";

type Props = {
  polygons: RoofPolygon[];
  activeIndex: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick: (index: number, attributes: any) => void; 

};

export default function RoofPolygons({ polygons, activeIndex, onClick }: Props) {
  return (
    <>
      {polygons.map((polygon, idx) => (
        <Polygon
          key={idx}
          positions={polygon.coords as LatLngTuple[]}
          pathOptions={{
            color: idx === activeIndex ? "#00FF00" : "rgba(255, 255, 255, 0.8)",
            weight: 2,
            dashArray: idx === activeIndex ? "0" : "6 6",
            fillColor: "rgba(255, 255, 255, 0.35)",
            fillOpacity: 1,
          }}
          eventHandlers={{
            click: () => onClick(idx, polygon.attributes),
          }}
        />
      ))}
    </>
  );
}
