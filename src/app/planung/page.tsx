"use client";

import dynamic from "next/dynamic";

// Carica dinamicamente la mappa per evitare problemi SSR
const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function PlanungPage() {
  return (
    <div className="h-full w-full">
      <Map />
    </div>
  );
}
