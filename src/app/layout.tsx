// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// import Sidebar from "@/components/Sidebar";

import { Toaster } from "react-hot-toast";
import { headers } from "next/headers";
import QueryProvider from "@/components/providers/QueryProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
  const isPlannerPage = pathname.startsWith("/planner-v2");

  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('sola-theme') || 'default';
                document.documentElement.setAttribute('data-theme', t);
                if (t !== 'light') document.documentElement.classList.add('dark');
                else document.documentElement.classList.remove('dark');
                document.documentElement.style.colorScheme = t === 'light' ? 'light' : 'dark';
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body
        className={[
          inter.className,
          "flex h-screen overflow-hidden",
          // niente bg-white: il bg lo gestiamo noi con hero.webp
          "bg-background text-foreground",
        ].join(" ")}
        style={
          isPlannerPage
            ? ({
                ["--sb" as string]: "0px",
              } as React.CSSProperties)
            : undefined
        }
      >
        {/* Background globale: hero.webp + blur + overlay */}
        {!isLoginPage && (
          <div className="pointer-events-none fixed inset-0 -z-10">
            <div
              className="absolute inset-0 bg-center bg-cover"
              style={{
                backgroundImage: isPlannerPage
                  ? "none"
                  : "url(/hero-helionic.jpeg)",
              }}
            />
            {/* blur leggero */}
            {!isPlannerPage && <div className="absolute inset-0 backdrop-blur-xs" />}
            {/* overlay per contrasto */}
            {!isPlannerPage && <div className="absolute inset-0 bg-black/35" />}
          </div>
        )}

        {/* Sidebar completamente nascosta nel progetto.
            Se dovesse servire di nuovo, ripristinare l'import sopra e questa riga:
            {!isLoginPage && !isPlannerPage && <Sidebar />} */}
        {/* {!isLoginPage && !isPlannerPage && <Sidebar />} */}

        <QueryProvider>
          <div className="flex flex-col flex-1 overflow-hidden">
            <main className="flex-1 overflow-auto relative">{children}</main>
          </div>

          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 2000,
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
