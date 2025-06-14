"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export default function Sidebar() {
  const [showProducts, setShowProducts] = useState(false);
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 
      backdrop-blur-xs bg-white/50 border-r border-white/20 
      text-black shadow-xl z-50 flex flex-col justify-between">

      {/* Navigation */}
      <nav className="px-6 pt-6">
        {/* Logo */}
        <div className="ms-5 text-4xl font-black tracking-tight mb-10 select-none">
          SOLA
        </div>

        {/* Menu items */}
        <div className="flex flex-col gap-5 text-lg font-light">
          <SidebarLink href="/" icon={<FiHome />} label="Home" pathname={pathname} />
          <SidebarLink href="/kunden" icon={<FiUsers />} label="Kunden" pathname={pathname} />
          <SidebarLink href="/auftraege" icon={<FiClipboard />} label="Aufträge" pathname={pathname} />
          <SidebarLink href="/umsatz" icon={<FiBarChart2 />} label="Umsatz" pathname={pathname} />
          <SidebarLink href="/aufgaben" icon={<FiBell />} label="Aufgaben" pathname={pathname} />
          <SidebarLink href="/planung" icon={<FiSettings />} label="Planung" pathname={pathname} />
          <SidebarLink href="/produkte" icon={<FiBox />} label="Produkte" pathname={pathname} />
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

// ✅ Link attivo con effetto glass
function SidebarLink({
  href,
  icon,
  label,
  pathname,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  pathname: string;
}) {
  const isActive = pathname === href;

  return (
<Link
  href={href}
  className={`relative flex items-center gap-3 px-4 py-2 rounded-full transition-all duration-300
    ${isActive ? "text-black font-semibold" : "text-black hover:text-neutral-500"}`}
>
  {isActive && (
    <span
      className="absolute inset-0 rounded-full z-[-1]
                 bg-white/20 backdrop-blur-[6px]
                 border border-white/30
                 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.4),inset_-1px_-1px_1px_rgba(0,0,0,0.1)]
                 transition-all duration-300"
    />
  )}
  <span className="text-xl">{icon}</span>
  <span>{label}</span>
</Link>

  );
}
