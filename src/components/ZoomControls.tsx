"use client";

import { useMap } from "react-leaflet";
import { FiPlus, FiMinus } from "react-icons/fi";

export default function ZoomControls() {
  const map = useMap();

  return (
    <div className="fixed bottom-8 right-6 z-[1000] flex flex-col gap-3">
      <button
        onClick={() => map.zoomIn()}
        className="p-3 bg-white/30 backdrop-blur-md border border-white/20 text-black rounded-full shadow-md hover:bg-white/40 transition"
        aria-label="Zoom in"
      >
        <FiPlus className="text-xl" />
      </button>
      <button
        onClick={() => map.zoomOut()}
        className="p-3 bg-white/30 backdrop-blur-md border border-white/20 text-black rounded-full shadow-md hover:bg-white/40 transition"
        aria-label="Zoom out"
      >
        <FiMinus className="text-xl" />
      </button>
    </div>
  );
}
