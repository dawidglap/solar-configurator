"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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

// layer pannelli
import SolarModulesPlacer from "./SolarModulesPlacer";

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [roofPolygons, setRoofPolygons] = useState<RoofPolygon[]>([]);
  const [selectedRoofAreas, setSelectedRoofAreas] = useState<RoofAttributes[]>([]);
  const [planningParams, setPlanningParams] = useState({
    targetKwp: 8.8,            // non usato ora, ma teniamo il campo
    margin: 0.3,
    spacing: 0.02,
    orientation: "portrait" as "portrait" | "landscape",
  });

  // Stats dai moduli
  const [moduleStats, setModuleStats] = useState<{ count: number; areaPlan: number }>({
    count: 0,
    areaPlan: 0,
  });

  // Log controllato per debug
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[MAP][STATS from placer]", moduleStats);
  }, [moduleStats.count, moduleStats.areaPlan]);

  const mapRef = useRef<L.Map | null>(null);

  // FlyTo verso la posizione selezionata solo se serve
  useEffect(() => {
    if (!mapRef.current || !selectedPosition) return;

    const map = mapRef.current;
    const currentCenter = map.getCenter();
    const dx = Math.abs(currentCenter.lat - selectedPosition.lat);
    const dy = Math.abs(currentCenter.lng - selectedPosition.lon);

    const distanceThreshold = 0.001; // ≈ 100 m
    const isFarEnough = dx > distanceThreshold || dy > distanceThreshold;

    if (isFarEnough) {
      map.flyTo([selectedPosition.lat, selectedPosition.lon], 20, { duration: 2 });
    }
  }, [selectedPosition]);

  // Idle pan discreto
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
      // eslint-disable-next-line no-console
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
    setModuleStats(prev =>
      prev.count === stats.count && prev.areaPlan === stats.areaPlan ? prev : stats
    );
  }, []);

  // 🔹 MICRO-STEP: Export JSON per preventivo
  const handleExportJSON = useCallback(() => {
    const attrs = (selectedRoofAreas[0] as any) || {};
    const modKwp = 0.4; // 400 W per modulo (MVP)
    const estimatedKwp = Number((moduleStats.count * modKwp).toFixed(1));

    const exportData = {
      timestamp: new Date().toISOString(),
      location: selectedPosition ? { lat: selectedPosition.lat, lon: selectedPosition.lon } : null,
      roof: {
        id: attrs.id ?? null,
        area_m2: attrs.flaeche ?? null,
        class: attrs.klasse ?? null,
        ausrichtung_deg: attrs.ausrichtung ?? null,
        neigung_deg: attrs.neigung ?? null,
        stromertrag_kwh: attrs.stromertrag ?? null,
      },
      planningParams,
      modules: {
        count: moduleStats.count,
        orientation: planningParams.orientation,
        moduleSize_m: [1.722, 1.134], // preset MVP
        spacing_m: planningParams.spacing,
        margin_m: planningParams.margin,
        area_plan_m2: Number(moduleStats.areaPlan.toFixed(2)),
        estimated_kwp: estimatedKwp,
      },
      // stima prezzo semplice, coerente con la tua footbar (97 CHF per kWp "area-based"): qui la leghiamo ai moduli
      priceEstimateCHF: Number((estimatedKwp * 97).toFixed(2)),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const roofId = attrs.id ? String(attrs.id) : "roof";
    a.href = url;
    a.download = `SOLA_plan_${roofId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [selectedRoofAreas, selectedPosition, planningParams, moduleStats]);

  return (
    <div className="relative h-screen w-screen">
      <PlannerSidebar
        visible={!!selectedPosition}
        params={planningParams}
        onChangeParams={setPlanningParams}
      />

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
          />

          {/* layer pannelli sulla falda attiva (visibile) */}
          {selectedPolygon && (
            <SolarModulesPlacer
              polygonCoords={selectedPolygon.coords as [number, number][]}
              ausrichtung={(selectedRoofAreas[0] as any)?.ausrichtung}
              neigung={(selectedRoofAreas[0] as any)?.neigung}
              marginMeters={planningParams.margin}
              spacingMeters={planningParams.spacing}
              orientation={planningParams.orientation}
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

      {selectedRoofAreas.length > 0 && <Footbar data={selectedRoofAreas} />}

      {/* 🔹 Bottone Export JSON (visibile solo con una falda selezionata) */}
      {selectedRoofAreas.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={handleExportJSON}
            className="px-4 py-2 rounded-full bg-black/70 text-white shadow hover:bg-black transition"
            title="Esporta piano in JSON"
          >
            Export JSON
          </button>
        </div>
      )}
    </div>
  );
}
