"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, useMapEvents, Polygon as RLPolygon } from "react-leaflet";

import AssignMapRef from "./MapComplete/AssignMapRef";
import type { RoofPolygon, RoofAttributes } from "@/types/roof";

import AddressSearch from "./AddressSearch";
import axios from "axios";
import ZoomControls from "./ZoomControls";
import L from "leaflet";
import PlannerSidebar from "./PlannerSidebar";
import Footbar from "./Footbar";
import RoofPolygonsRenderer from "./MapComplete/RoofPolygonsRenderer";
import SolarModulesPlacer from "./SolarModulesPlacer";

// --- piccolo helper UI (floating action button)
function Fab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-6 bottom-24 z-[1000] px-3 py-2 rounded-full shadow-lg border
        ${active ? "bg-red-600 text-white border-red-700" : "bg-white/80 text-black border-black/10"}
        backdrop-blur hover:bg-white`}
      title="Disegna zona esclusa (2 click)"
    >
      {active ? "🛑 Fine disegno" : "🚫 Zona esclusa"}
    </button>
  );
}

// --- cattura 2 click e produce un rettangolo [lat,lng][]; solo quando active=true
function ExclusionDrawer({
  active,
  onRectDone,
}: {
  active: boolean;
  onRectDone: (poly: [number, number][]) => void;
}) {
  const clicksRef = useRef<[number, number][]>([]);

  useMapEvents({
    click(e) {
      if (!active) return;
      clicksRef.current.push([e.latlng.lat, e.latlng.lng]);
      if (clicksRef.current.length === 2) {
        const [aLat, aLng] = clicksRef.current[0];
        const [bLat, bLng] = clicksRef.current[1];
        const minLat = Math.min(aLat, bLat);
        const maxLat = Math.max(aLat, bLat);
        const minLng = Math.min(aLng, bLng);
        const maxLng = Math.max(aLng, bLng);
        const rect: [number, number][] = [
          [minLat, minLng],
          [minLat, maxLng],
          [maxLat, maxLng],
          [maxLat, minLng],
          [minLat, minLng],
        ];
        onRectDone(rect);
        clicksRef.current = [];
      }
    },
    // se esci con ESC azzera (facoltativo)
    keydown(e: any) {
      if (!active) return;
      if (e.originalEvent?.key === "Escape") clicksRef.current = [];
    },
  });

  return null;
}

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofAreas, setSelectedRoofAreas] = useState<RoofAttributes[]>([]);
  const [planningParams, setPlanningParams] = useState({
    targetKwp: 8.8,
    margin: 0.3,
    spacing: 0.02,
    orientation: "portrait" as "portrait" | "landscape",
  });

  // ⬇️ NUOVO: esclusioni e modalità disegno
  const [exclusions, setExclusions] = useState<[number, number][][]>([]);
  const [drawExclude, setDrawExclude] = useState(false);

  // Stats dai moduli
  const [moduleStats, setModuleStats] = useState<{ count: number; areaPlan: number }>({
    count: 0,
    areaPlan: 0,
  });

  useEffect(() => {
    console.log("[MAP][STATS from placer]", moduleStats);
  }, [moduleStats.count, moduleStats.areaPlan]);

  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !selectedPosition) return;
    const map = mapRef.current;
    const currentCenter = map.getCenter();
    const dx = Math.abs(currentCenter.lat - selectedPosition.lat);
    const dy = Math.abs(currentCenter.lng - selectedPosition.lon);
    const distanceThreshold = 0.001; // ≈ 100 m
    const isFarEnough = dx > distanceThreshold || dy > distanceThreshold;
    if (isFarEnough) map.flyTo([selectedPosition.lat, selectedPosition.lon], 20, { duration: 2 });
  }, [selectedPosition]);

  const idlePanIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedPosition || !mapRef.current) return;
    if (idlePanIntervalRef.current) return;

    let frame = 0;
    const MAX_STEPS = 6;
    idlePanIntervalRef.current = window.setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      const lat = center.lat + Math.sin(frame / 200) * 0.0001;
      const lng = center.lng + 0.00015;
      map.setView([lat, lng], map.getZoom(), { animate: false });
      frame++;
      if (frame >= MAX_STEPS) {
        window.clearInterval(idlePanIntervalRef.current!);
        idlePanIntervalRef.current = null;
      }
    }, 5000);

    return () => {
      if (idlePanIntervalRef.current) {
        window.clearInterval(idlePanIntervalRef.current);
        idlePanIntervalRef.current = null;
      }
    };
  }, [selectedPosition]);

  const handleSelectLocation = async (lat: number, lon: number) => {
    if (!selectedPosition) setSelectedPosition({ lat, lon });

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
      if (results.length === 0) {
        setRoofPolygons([]);
        return;
      }

      const polygons: RoofPolygon[] = [];
      results.forEach((res: any) => {
        const rings = res.geometry?.rings;
        const eignung = res.attributes?.dach_eignung;
        if (rings && Array.isArray(rings)) {
          rings.forEach((ring: number[][]) => {
            const converted = ring.map(([lng2, lat2]) => [lat2, lng2]);
            polygons.push({ coords: converted, eignung, attributes: res.attributes });
          });
        }
      });

      setRoofPolygons(polygons);
    } catch (error: any) {
      console.error("❌ Errore:", error?.message || error);
    }
  };

  // individua la falda selezionata tramite la chiave __polyKey
  const selectedKey = (selectedRoofAreas[0] as any)?.__polyKey as string | undefined;

  const selectedPolygon: RoofPolygon | undefined = useMemo(() => {
    if (!selectedKey) return undefined;
    return roofPolygons.find((p, i) => `${p.attributes.id}::${i}` === selectedKey);
  }, [roofPolygons, selectedKey]);

  // Callback stabile per stats
  const handleStats = useCallback((stats: { count: number; areaPlan: number }) => {
    setModuleStats((prev) =>
      prev.count === stats.count && prev.areaPlan === stats.areaPlan ? prev : stats
    );
  }, []);

  // quando chiudi/riapri la selezione posizione, reset esclusioni (facoltativo)
  useEffect(() => {
    // resetta le esclusioni se cambi tetto selezionato
    setExclusions([]);
  }, [selectedKey]);

  return (
    <div className="relative h-screen w-screen">
      <PlannerSidebar
        visible={!!selectedPosition}
        params={planningParams}
        onChangeParams={setPlanningParams}
      />

      {/* FAB per disegnare zona esclusa */}
      <Fab active={drawExclude} onClick={() => setDrawExclude((v) => !v)} />

      <div className="absolute inset-0 z-0">
        <MapContainer
          key="main-map"
          center={[47.3769, 8.5417]}
          zoom={13}
          scrollWheelZoom
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
            excludePoor // mantieni filtro aree scadenti attivo
          />

          {/* Disegno rettangolo di esclusione quando attivo */}
          <ExclusionDrawer
            active={drawExclude}
            onRectDone={(poly) => {
              setExclusions((prev) => [...prev, poly]);
              setDrawExclude(false);
            }}
          />

          {/* Visualizza poligoni di esclusione (rosso) */}
          {exclusions.map((poly, i) => (
            <RLPolygon
              key={`ex-${i}`}
              positions={poly as [number, number][]}
              pathOptions={{
                color: "rgba(220, 38, 38, 1)",      // rosso
                weight: 1,
                fillColor: "rgba(220, 38, 38, 0.35)",
                fillOpacity: 0.7,
              }}
            />
          ))}

          {/* layer pannelli sulla falda attiva */}
          {selectedPolygon && (
            <SolarModulesPlacer
              polygonCoords={selectedPolygon.coords as [number, number][]}
              ausrichtung={(selectedRoofAreas[0] as any)?.ausrichtung}
              neigung={(selectedRoofAreas[0] as any)?.neigung}
              marginMeters={planningParams.margin}
              spacingMeters={planningParams.spacing}
              orientation={planningParams.orientation}
              exclusions={exclusions}          // ⬅️ PASSIAMO LE ESCLUSIONI
              fillMode
              visible
              onStats={handleStats}
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

      {selectedRoofAreas.length > 0 && (
        <Footbar data={selectedRoofAreas} modsStats={moduleStats} />
      )}
    </div>
  );
}
