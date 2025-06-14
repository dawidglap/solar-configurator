"use client";
import { useState } from "react";
import Link from "next/link";
import {
  FiHome,
  FiUsers,
  FiClipboard,
  FiBarChart2,
  FiBell,
  FiSettings,
  FiBox,
  FiUser,
} from "react-icons/fi";
import { BsChevronDown } from "react-icons/bs";

export default function Sidebar() {
  const [showProducts, setShowProducts] = useState(false);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white text-black shadow-md flex flex-col justify-between">
      <nav className="px-6 pt-6">
        {/* Logo */}
        <div className="text-4xl font-black tracking-tight mb-10 select-none">
          SOLA
        </div>

        {/* Menu items */}
        <div className="flex flex-col gap-5 text-lg font-light">
          <SidebarItem icon={<FiHome />} label="Home" />
          <SidebarItem icon={<FiUsers />} label="Kunden" />
          <SidebarItem icon={<FiClipboard />} label="Aufträge" />
          <SidebarItem icon={<FiBarChart2 />} label="Umsatz" />
          <SidebarItem icon={<FiBell />} label="Aufgaben" />
          <SidebarLink href="/planung" icon={<FiSettings />} label="Planung" />
          <SidebarItem icon={<FiBox />} label="Produkte" />
        </div>
      </nav>

      {/* Profilo in basso */}
      <div className="px-6 pb-6">
        <div className="flex items-center gap-3 text-lg cursor-not-allowed text-black opacity-80 select-none">
          <FiUser className="text-xl" />
          <span>Mein Profil</span>
        </div>
      </div>
    </aside>
  );
}

// ✅ Link cliccabile (solo Planung)
function SidebarLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 text-black hover:text-neutral-500 transition"
    >
      <span className="text-xl">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

// ❌ Voci disabilitate
function SidebarItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 text-black opacity-50 cursor-not-allowed select-none">
      <span className="text-xl">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
