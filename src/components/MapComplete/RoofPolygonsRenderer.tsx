"use client";

import { Polygon } from "react-leaflet";

type RoofPolygon = {
  coords: number[][];
  eignung: number;
  attributes: { id: string; [key: string]: any };
};

type Props = {
  roofPolygons: RoofPolygon[];
  selectedRoofAreas: RoofPolygon["attributes"][];
  setSelectedRoofAreas: (infos: RoofPolygon["attributes"][]) => void;
  excludePoor?: boolean;
};

export default function RoofPolygonsRenderer({
  roofPolygons,
  selectedRoofAreas,
  setSelectedRoofAreas,
  excludePoor = false,
}: Props) {
  const MIN_GOOD = 3; // 3=gut, 4=sehr gut, 5=hervorragend

  return (
    <>
      {roofPolygons.map((polygon, idx) => {
        const polyKey = `${polygon.attributes.id}::${idx}`;
        const selectedKey = selectedRoofAreas[0]?.__polyKey as string | undefined;
        const isSelected = selectedKey === polyKey;

        // Sonnendach: prova prima attributes.klasse, fallback su polygon.eignung
        const scoreRaw = (polygon.attributes as any)?.klasse ?? polygon.eignung ?? 0;
        const score = Number(scoreRaw) || 0;

        // ✅ poor = classi 1..2 (solo se excludePoor=true)
        const isPoor = excludePoor && score > 0 && score < MIN_GOOD;

        const stroke = isSelected
          ? "#00FF00"
          : isPoor
          ? "rgba(160,160,160,0.9)"
          : "rgba(255,255,255,0.9)";

        const fill = isPoor ? "rgba(160,160,160,0.25)" : "rgba(255,255,255,0.35)";
        const dash = isSelected ? "0" : isPoor ? "2 6" : "6 6";

        const interactive = !isPoor; // niente click su poor se stiamo escludendo

        return (
          <Polygon
            key={polyKey}
            positions={polygon.coords as [number, number][]}
            pathOptions={{ color: stroke, weight: 2, dashArray: dash, fillColor: fill, fillOpacity: 1 }}
            interactive={interactive}
            eventHandlers={
              interactive
                ? {
                    click: () => {
                      if (isSelected) {
                        setSelectedRoofAreas([]);
                      } else {
                        setSelectedRoofAreas([{ ...(polygon.attributes as any), __polyKey: polyKey }]);
                      }
                    },
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
