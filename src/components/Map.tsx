"use client";

import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import AddressSearch from "./AddressSearch";
import axios from "axios";
import { Toolbar } from "@/components/Toolbar";
import RoofInfoPanel from "./Map/RoofInfoPanel";
import WrapperLayout from "./Layout/WrapperLayout";

function FlyToLocation({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  map.flyTo([lat, lon], 20, {
    duration: 2,
    easeLinearity: 0.25,
  });
  return null;
}

type RoofPolygon = {
  coords: number[][];
  eignung: number;
  attributes: any;
};

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [mode, setMode] = useState("single");
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofInfo, setSelectedRoofInfo] = useState<any>(null);

  const handleSelectLocation = async (lat: number, lon: number) => {
    setSelectedPosition({ lat, lon });

    try {
      const identifyResponse = await axios.get(
        "https://api3.geo.admin.ch/rest/services/energie/MapServer/identify",
        {
          params: {
            geometryType: "esriGeometryPoint",
            geometry: `${lon},${lat}`,
            sr: 4326,
            layers: "all:ch.bfe.solarenergie-eignung-daecher",
            tolerance: 3,
            mapExtent: `${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`,
            imageDisplay: "600,400,96",
            lang: "it",
          },
        }
      );

      const results = identifyResponse.data?.results ?? [];
      if (results.length === 0) {
        console.warn("⚠️ Nessun risultato da identify");
        return;
      }

      const polygons: RoofPolygon[] = [];

      results.forEach((res: any) => {
        const rings = res.geometry?.rings;
        const eignung = res.attributes?.dach_eignung;

        if (rings && Array.isArray(rings)) {
          rings.forEach((ring: number[][]) => {
            const converted = ring.map(([lng, lat]) => [lat, lng]);
            polygons.push({ coords: converted, eignung, attributes: res.attributes });
          });
        }
      });

      console.log("✅ Poligoni totali:", polygons.length);
      setRoofPolygons(polygons);
    } catch (error: any) {
      console.error("❌ Errore:", error?.message || error);
    }
  };

  const getColor = (eignung: number) => {
    switch (eignung) {
      case 1:
        return "#f97316"; // Ottimo
      case 2:
        return "#eab308"; // Buono
      case 3:
        return "#ef4444"; // Limitato
      default:
        return "#22c55e"; // fallback
    }
  };

  return (
  <>
    <RoofInfoPanel data={selectedRoofInfo} />

    {/* Toolbar sopra la mappa */}
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1000]">
      <Toolbar value={mode} onChange={(val) => val && setMode(val)} />
    </div>

    {/* Mappa principale */}
    <div className="relative ml-64 mt-0 h-[calc(100vh-4rem)] w-[calc(100vw-16rem)] overflow-hidden">
      <MapContainer
        center={[47.3769, 8.5417]}
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="© swisstopo"
          url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
          maxZoom={20}
        />

        {selectedPosition && (
          <FlyToLocation lat={selectedPosition.lat} lon={selectedPosition.lon} />
        )}

        {roofPolygons.map((polygon, idx) => (
          <Polygon
            key={idx}
            positions={polygon.coords}
            pathOptions={{
              color: getColor(polygon.eignung),
              weight: 2,
              fillOpacity: 0.4,
            }}
            eventHandlers={{
              click: () => setSelectedRoofInfo(polygon.attributes),
            }}
          />
        ))}
      </MapContainer>

      <AddressSearch onSelectLocation={handleSelectLocation} />
    </div>
  </>
);

}
