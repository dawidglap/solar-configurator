import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Layout/Navbar";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "SOLA Dashboard",
  description: "Solarplanung App",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body
        className={`${montserrat.className} flex h-screen overflow-hidden bg-white text-black`}
      >
        {/* Sidebar fissa a sinistra */}
        <Sidebar />

        {/* Contenuto a destra della sidebar */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Navbar fissa in alto */}
          {/* <Navbar /> */}

          {/* Contenuto scrollabile sotto la navbar */}
          <main className="flex-1 overflow-auto relative">{children}</main>
        </div>
      </body>
    </html>
  );
}
