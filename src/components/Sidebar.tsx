// components/Sidebar.tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { FiHome, FiUsers, FiClipboard, FiBarChart2, FiBell, FiSettings, FiBox } from "react-icons/fi";
import { BsChevronDown } from "react-icons/bs";

export default function Sidebar() {
  const [showProducts, setShowProducts] = useState(false);

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-gradient-to-b from-gray-900 to-gray-800 text-white shadow-lg z-50">
      <nav className="flex flex-col gap-4 p-6 text-sm">
        <SidebarLink href="/dashboard" icon={<FiHome />} label="Home" />
        <SidebarLink href="/kunden" icon={<FiUsers />} label="Kunden" />
        <SidebarLink href="/auftraege" icon={<FiClipboard />} label="Aufträge" />
        <SidebarLink href="/umsatz" icon={<FiBarChart2 />} label="Umsatz" />
        <SidebarLink href="/aufgaben" icon={<FiBell />} label="Aufgaben" />
        <SidebarLink href="/planung" icon={<FiSettings />} label="Planung" />

        {/* Dropdown voice */}
        <div>
          <button
            className="flex items-center gap-3 px-2 py-1.5 hover:text-gray-300 w-full"
            onClick={() => setShowProducts(!showProducts)}
          >
            <FiBox className="text-lg" />
            <span className="flex-1 text-left">Produkte</span>
            <BsChevronDown className={`transition-transform ${showProducts ? "rotate-180" : ""}`} />
          </button>
          {showProducts && (
            <div className="ml-8 mt-1 flex flex-col gap-1 text-gray-300">
              <Link href="/produkte/solarmodule" className="hover:text-white">
                Solarmodule
              </Link>
              <Link href="/produkte/wechslerichter" className="hover:text-white">
                Wechselrichter
              </Link>
              <Link href="/produkte/speicher" className="hover:text-white">
                Speicher
              </Link>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}

function SidebarLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-2 py-1.5 hover:text-gray-300">
      <span className="text-lg">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
