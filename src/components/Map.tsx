"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
} from "react-leaflet";

import AddressSearch from "./AddressSearch";
import axios from "axios";
import RoofInfoPanel from "./Map/RoofInfoPanel";
import ZoomControls from "./ZoomControls";
import L from "leaflet";
import { Toolbar } from "./Toolbar";


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
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofInfo, setSelectedRoofInfo] = useState<any>(null);
  const [mode, setMode] = useState("single");

  const mapRef = useRef<L.Map | null>(null);

  // ✅ Movimento automatico fluido
  useEffect(() => {
    if (selectedPosition || !mapRef.current) return;

    let frame = 0;
    const interval = setInterval(() => {
      if (!mapRef.current) return;

      const center = mapRef.current.getCenter();
      const lat = center.lat + Math.sin(frame / 200) * 0.0001;
      const lng = center.lng + 0.00015;

      mapRef.current.flyTo([lat, lng], mapRef.current.getZoom(), {
        duration: 3,
        easeLinearity: 0.1,
      });

      frame++;
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedPosition]);

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
      if (results.length === 0) return;

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

      setRoofPolygons(polygons);
    } catch (error: any) {
      console.error("❌ Errore:", error?.message || error);
    }
  };

  return (
    <div className="relative h-screen w-screen">
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={[47.3769, 8.5417]}
          zoom={13}
          scrollWheelZoom={true}
          zoomControl={false}
          style={{ height: "100%", width: "100%" }}
          whenCreated={(mapInstance) => {
            mapRef.current = mapInstance;
          }}
        >
            

          <TileLayer
            attribution="© swisstopo"
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
            maxZoom={20}
          />

          <ZoomControls />

          {selectedPosition && (
            <FlyToLocation lat={selectedPosition.lat} lon={selectedPosition.lon} />
          )}

          {roofPolygons.map((polygon, idx) => (
            <Polygon
              key={idx}
              positions={polygon.coords}
              pathOptions={{
                color: "rgba(255, 255, 255, 0.8)",
                weight: 2,
                dashArray: "6 6",
                fillColor: "rgba(255, 255, 255, 0.35)",
                fillOpacity: 1,
              }}
              eventHandlers={{
                click: () => setSelectedRoofInfo(polygon.attributes),
              }}
            />
          ))}
        </MapContainer>
      </div>

      <RoofInfoPanel data={selectedRoofInfo} />
      <Toolbar value={mode} onChange={(val) => val && setMode(val)} />

      <div
        className="fixed top-16 z-50"
        style={{ left: "calc(50% - 8rem)", transform: "translateX(-50%)" }}
      >
        <AddressSearch onSelectLocation={handleSelectLocation} />
      </div>
    </div>
  );
}
