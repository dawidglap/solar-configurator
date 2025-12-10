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
  // 🔹 headers() è async in Next 15
  const h = await headers();

  // Proviamo prima x-pathname, poi x-invoke-path, altrimenti '/'
  const pathname = h.get("x-pathname") || h.get("x-invoke-path") || "/";

  const isLoginPage = pathname.startsWith("/login");

  return (
    <html lang="de">
      <body
        className={`${montserrat.className} flex h-screen overflow-hidden bg-white text-black`}
      >
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
