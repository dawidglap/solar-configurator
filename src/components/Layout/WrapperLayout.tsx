"use client";

import Navbar from "./Navbar";
import Image from "next/image";

export default function WrapperLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/bg.jpg"
          alt="Sfondo"
          fill
          priority
          className="object-cover opacity-70"
        />
      </div>

      {/* Contenuto principale (shiftato a destra della sidebar) */}
      <div className="relative z-10  h-full">
        <Navbar />
        <main className="h-[calc(100%-64px)] w-full">{children}</main>
      </div>
    </div>
  );
}
