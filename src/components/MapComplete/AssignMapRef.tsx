"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

type Props = {
  mapRef: React.MutableRefObject<L.Map | null>;
};

export default function AssignMapRef({ mapRef }: Props) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  return null;
}
