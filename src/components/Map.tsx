"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
} from "react-leaflet";

import SolarModulesPlacer from "./SolarModulesPlacer";

import AddressSearch from "./AddressSearch";
import axios from "axios";

import ZoomControls from "./ZoomControls";
import L from "leaflet";
import { Toolbar } from "./Toolbar";
import PlannerSidebar from "./PlannerSidebar";
import Footbar from "./Footbar";
import SingleSolarModule from "./SingleSolarModule";
import StromverbrauchInput from "./StromverbrauchInput";
import ElektroautoFrage from "./ElektroautoFrage";



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
  attributes: any; //eslint-disable-line @typescript-eslint/no-explicit-any
};

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofInfo, setSelectedRoofInfo] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const [mode, setMode] = useState("single");
  const [resetModules, setResetModules] = useState(false);
const [step, setStep] = useState<"none" | "strom" | "auto">("none");
const [stromverbrauch, setStromverbrauch] = useState(10000);




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
    setStep("strom"); // mostra la prima domanda


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
            lang: "de",
          },
        }
      );

      const results = identifyResponse.data?.results ?? [];
      if (results.length === 0) return;
      console.log("✅ Raw API response:", results[0]?.attributes);


      const polygons: RoofPolygon[] = [];

      results.forEach((res: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const rings = res.geometry?.rings;
        const eignung = res.attributes?.dach_eignung;

        if (rings && Array.isArray(rings)) {
          rings.forEach((ring: number[][]) => {
            const converted = ring.map(([lng, lat]) => [lat, lng]);
            polygons.push({ coords: converted, eignung, attributes: res.attributes });
          });
        }
      });

      if (polygons.length > 0) {
  setSelectedRoofInfo(polygons[0].attributes);
}

      setRoofPolygons(polygons);
    } catch (error: any) { //eslint-disable-line @typescript-eslint/no-explicit-any
      console.error("❌ Errore:", error?.message || error);
    }
  };

  return (
    <div className="relative h-screen w-screen">
<PlannerSidebar visible={!!selectedPosition} />


{step === "strom" && (
  <StromverbrauchInput
    value={stromverbrauch}
    onChange={setStromverbrauch}
    onNext={() => setStep("auto")}
  />
)}


{step === "auto" && (
  <ElektroautoFrage
    onNext={(antwort) => {
      console.log("🚗 Risposta auto:", antwort);
      setStep("weiter");
    }}
  />
)}



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
{roofPolygons[0]?.coords && mode === "fill" && (
<SolarModulesPlacer
  polygonCoords={roofPolygons[0]?.coords}
  ausrichtung={roofPolygons[0]?.attributes?.ausrichtung}
  visible={mode === "fill" || mode === "single"}
  mode={mode}
/>



)}

<SingleSolarModule
  visible={mode === "single"}
  ausrichtung={selectedRoofInfo?.ausrichtung}
resetTrigger={resetModules}
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

      {/* <RoofInfoPanel data={selectedRoofInfo} /> */}
      <Toolbar value={mode}  onChange={(val) => {
    if (!val) return;
    setMode(val);

    if (val === "deleteAll") {
      setResetModules(true);
      setTimeout(() => setResetModules(false), 100); // reset il trigger
    }
  }}/>

      <div
        className="fixed top-16 z-50"
        style={{ left: "calc(50% - 8rem)", transform: "translateX(-50%)" }}
      >
        <AddressSearch onSelectLocation={handleSelectLocation} />
      </div>
      <Footbar data={selectedRoofInfo} />

    </div>
  );
}
