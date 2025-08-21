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
  const polyKey = `${polygon.attributes.id}::${idx}`;
  const selectedKey = selectedRoofAreas[0]?.__polyKey as string | undefined; // <-- usa chiave salvata
  const isSelected = selectedKey === polyKey;

  return (
    <Polygon
      key={polyKey}
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
          if (isSelected) {
            setSelectedRoofAreas([]);
          } else {
            // salviamo anche la chiave unica del poligono selezionato
            setSelectedRoofAreas([{ ...polygon.attributes, __polyKey: polyKey } as any]);
          }
        },
      }}
    />
  );
})}

    </>
  );
}
