"use client";

import { Polygon } from "react-leaflet";

type RoofPolygon = {
  coords: number[][];
  eignung: number;
  attributes: any;
};

type Props = {
  roofPolygons: RoofPolygon[];
  activePolygonIndex: number | null;
  setSelectedRoofInfo: (info: any) => void;
  setActivePolygonIndex: (idx: number) => void;
};

export default function RoofPolygonsRenderer({
  roofPolygons,
  activePolygonIndex,
  setSelectedRoofInfo,
  setActivePolygonIndex,
}: Props) {
  return (
    <>
      {roofPolygons.map((polygon, idx) => (
        <Polygon
          key={idx}
          positions={polygon.coords as [number, number][]}
          pathOptions={{
            color: idx === activePolygonIndex ? "#00FF00" : "rgba(255, 255, 255, 0.8)",
            weight: 2,
            dashArray: idx === activePolygonIndex ? "0" : "6 6",
            fillColor: "rgba(255, 255, 255, 0.35)",
            fillOpacity: 1,
          }}
          eventHandlers={{
            click: () => {
              setSelectedRoofInfo(polygon.attributes);
              setActivePolygonIndex(idx);
            },
          }}
        />
      ))}
    </>
  );
}
