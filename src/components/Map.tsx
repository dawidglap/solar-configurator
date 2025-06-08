"use client";

import { useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import AddressSearch from "./AddressSearch";

function FlyToLocation({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  map.flyTo([lat, lon], 19, {
    duration: 2,
    easeLinearity: 0.25,
  });
  return null;
}

export default function Map() {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lon: number } | null>(null);

  return (
    <div className="relative h-screen w-full">
      <MapContainer
        center={[47.3769, 8.5417]} // posizione iniziale: Zurigo
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='© swisstopo'
          url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
          maxZoom={20}
        />
        {selectedPosition && <FlyToLocation lat={selectedPosition.lat} lon={selectedPosition.lon} />}
      </MapContainer>

      <AddressSearch
        onSelectLocation={(lat, lon) => {
          setSelectedPosition({ lat, lon });
        }}
      />
    </div>
  );
}
