"use client";

import { Polygon } from "react-leaflet";

type RoofPolygon = {
  coords: number[][];
  eignung: number;
  attributes: { id: string; [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type Props = {
  roofPolygons: RoofPolygon[];
  selectedRoofAreas: RoofPolygon["attributes"][];
  setSelectedRoofAreas: (infos: RoofPolygon["attributes"][]) => void;
};

export default function RoofPolygonsRenderer({
  roofPolygons,
  selectedRoofAreas,
  setSelectedRoofAreas,
}: Props) {
  return (
    <>
      {roofPolygons.map((polygon, idx) => {
        const isSelected = selectedRoofAreas.some(
          (area) => area.id === polygon.attributes.id
        );

        return (
          <Polygon
            key={idx}
            positions={polygon.coords as [number, number][]}
            pathOptions={{
              color: isSelected ? "#00FF00" : "rgba(255, 255, 255, 0.8)",
              weight: 2,
              dashArray: isSelected ? "0" : "6 6",
              fillColor: "rgba(255, 255, 255, 0.35)",
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () => {
                const exists = selectedRoofAreas.some(
                  (area) => area.id === polygon.attributes.id
                );

                if (exists) {
                  setSelectedRoofAreas(
                    selectedRoofAreas.filter(
                      (area) => area.id !== polygon.attributes.id
                    )
                  );
                } else {
                  setSelectedRoofAreas([...selectedRoofAreas, polygon.attributes]);
                }
              },
            }}
          />
        );
      })}
    </>
  );
}
