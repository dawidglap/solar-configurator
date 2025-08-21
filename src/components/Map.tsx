"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";

import AssignMapRef from "./MapComplete/AssignMapRef";
import type { RoofPolygon, RoofAttributes } from "@/types/roof";

import AddressSearch from "./AddressSearch";
import axios from "axios";
import ZoomControls from "./ZoomControls";
import L from "leaflet";
import PlannerSidebar from "./PlannerSidebar";
import Footbar from "./Footbar";
import RoofPolygonsRenderer from "./MapComplete/RoofPolygonsRenderer";

// ⬇️ NUOVO: layer pannelli
import SolarModulesPlacer from "./SolarModulesPlacer";

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofAreas, setSelectedRoofAreas] = useState<RoofAttributes[]>([]);
  const [planningParams, setPlanningParams] = useState({
    targetKwp: 8.8,
    margin: 0.3,
    spacing: 0.02,
  });

  const mapRef = useRef<L.Map | null>(null);
  const previousPosition = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!mapRef.current || !selectedPosition) return;

    const map = mapRef.current;
    const currentCenter = map.getCenter();
    const dx = Math.abs(currentCenter.lat - selectedPosition.lat);
    const dy = Math.abs(currentCenter.lng - selectedPosition.lon);

    const distanceThreshold = 0.001; // ≈ 100 metri
    const isFarEnough = dx > distanceThreshold || dy > distanceThreshold;

    if (isFarEnough) {
      map.flyTo([selectedPosition.lat, selectedPosition.lon], 20, {
        duration: 2,
      });
      previousPosition.current = selectedPosition;
    }
  }, [selectedPosition]);

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
    if (!selectedPosition) {
      setSelectedPosition({ lat, lon });
    }

    try {
      const identifyResponse = await axios.get(
        "https://api3.geo.admin.ch/rest/services/energie/MapServer/identify",
        {
          params: {
            geometryType: "esriGeometryPoint",
            geometry: `${lon},${lat}`,
            sr: 4326,
            layers: "all:ch.bfe.solarenergie-eignung-daecher",
            tolerance: 10,
            mapExtent: `${lon - 0.002},${lat - 0.002},${lon + 0.002},${lat + 0.002}`,
            imageDisplay: "600,400,96",
            lang: "de",
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

  // ⬇️ NUOVO: individua la falda selezionata tramite la chiave __polyKey
  const selectedKey = (selectedRoofAreas[0] as any)?.__polyKey as string | undefined;
  const selectedPolygon: RoofPolygon | undefined = selectedKey
    ? roofPolygons.find((p, i) => `${p.attributes.id}::${i}` === selectedKey)
    : undefined;

  return (
    <div className="relative h-screen w-screen">
      <PlannerSidebar
        visible={!!selectedPosition}
        params={planningParams}
        onChangeParams={setPlanningParams}
      />

      <div className="absolute inset-0 z-0">
        <MapContainer
          center={[47.3769, 8.5417]}
          zoom={13}
          scrollWheelZoom={true}
          zoomControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <AssignMapRef mapRef={mapRef} />

          <TileLayer
            attribution="© swisstopo"
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
            maxZoom={20}
          />

          <ZoomControls />

          <RoofPolygonsRenderer
            roofPolygons={roofPolygons}
            selectedRoofAreas={selectedRoofAreas}
            setSelectedRoofAreas={setSelectedRoofAreas}
          />

          {/* ⬇️ NUOVO: layer pannelli sulla falda attiva (visibile) */}
          {selectedPolygon && (
            <SolarModulesPlacer
              polygonCoords={selectedPolygon.coords as [number, number][]}
              ausrichtung={(selectedRoofAreas[0] as any)?.ausrichtung || 0}
              moduleSizeMeters={[1.722, 1.134]} // 400 W demo
              fillMode={true}
              visible={true}
            />
          )}
        </MapContainer>
      </div>

      <div
        className="fixed top-16 z-50"
        style={{ left: "calc(50% - 8rem)", transform: "translateX(-50%)" }}
      >
        <AddressSearch onSelectLocation={handleSelectLocation} />
      </div>

      {selectedRoofAreas.length > 0 && <Footbar data={selectedRoofAreas} />}
    </div>
  );
}
