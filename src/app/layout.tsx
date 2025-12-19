// src/app/layout.tsx
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

import { Toaster } from "react-hot-toast";
import { headers } from "next/headers";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "SOLA Dashboard",
  description: "Solarplanung App",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const pathname = h.get("x-pathname") || h.get("x-invoke-path") || "/";
  const isLoginPage = pathname.startsWith("/login");

  return (
    <html lang="de">
      <body
        className={[
          montserrat.className,
          "flex h-screen overflow-hidden",
          // niente bg-white: il bg lo gestiamo noi con hero.webp
          "text-white",
        ].join(" ")}
      >
        {/* Background globale: hero.webp + blur + overlay */}
        {!isLoginPage && (
          <div className="pointer-events-none fixed inset-0 -z-10">
            <div
              className="absolute inset-0 bg-center bg-cover"
              style={{ backgroundImage: "url(/images/hero.webp)" }}
            />
            {/* blur leggero */}
            <div className="absolute inset-0 backdrop-blur-xs" />
            {/* overlay per contrasto */}
            <div className="absolute inset-0 bg-black/35" />
          </div>
        )}

        {/* Sidebar visibile ovunque tranne /login */}
        {!isLoginPage && <Sidebar />}

        <div className="flex flex-col flex-1 overflow-hidden">
          <main className="flex-1 overflow-auto relative">{children}</main>
        </div>

        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 2000,
          }}
        />
      </body>
    </html>
  );
}
