"use client";


import dynamic from "next/dynamic";

// Import dinamico per evitare problemi con SSR
const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function Home() {
  return (
    <main className="h-screen">
      <Map />
    </main>
  );
}
