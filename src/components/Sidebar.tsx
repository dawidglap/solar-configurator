"use client";

import { useEffect, useState } from "react";
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
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";

export default function Sidebar() {
  const [showProducts, setShowProducts] = useState(false); //eslint-disable-line @typescript-eslint/no-unused-vars
  const pathname = usePathname();

  // ⬇️ Collassa automaticamente su /planner-v2
  const isPlannerV2 = pathname?.startsWith("/planner-v2") ?? false;
  const [collapsed, setCollapsed] = useState<boolean>(isPlannerV2);

  // Se cambio rotta, riallinea lo stato
  useEffect(() => {
    setCollapsed(isPlannerV2);
  }, [isPlannerV2]);

  return (
    <>
      {/* Toggle handle - visibile solo su /planner-v2 */}
      {isPlannerV2 && (
        <button
          aria-label={collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"}
          title={collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"}
          onClick={() => setCollapsed((s) => !s)}
          className="fixed left-2 top-1/2 z-[60] -translate-y-1/2 flex h-9 w-9 items-center justify-center
                     rounded-full border border-white/40 bg-white/90 shadow hover:bg-white transition"
        >
          {collapsed ? <FiChevronRight className="text-black" /> : <FiChevronLeft className="text-black" />}
        </button>
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-52 flex-col justify-between
                    border-r border-white/20 bg-white text-black shadow-xl backdrop-blur-xs
                    transition-transform duration-300
                    ${collapsed ? "-translate-x-48" : "translate-x-0"}`}
      >
        {/* Navigation */}
        <nav className="px-6 pt-6">
          {/* Logo */}
          <div className="ms-2 mb-10 select-none text-3xl font-black tracking-tight">
            S O L A
          </div>

          {/* Menu items */}
          <div className="flex flex-col gap-3 text-sm font-light">
            <SidebarLink href="/" icon={<FiHome />} label="Home" pathname={pathname!} />
            <SidebarLink href="/kunden" icon={<FiUsers />} label="Kunden" pathname={pathname!} />
            <SidebarLink href="/auftraege" icon={<FiClipboard />} label="Aufträge" pathname={pathname!} />
            <SidebarLink href="/umsatz" icon={<FiBarChart2 />} label="Umsatz" pathname={pathname!} />
            <SidebarLink href="/aufgaben" icon={<FiBell />} label="Aufgaben" pathname={pathname!} />
            <SidebarLink href="/planung" icon={<FiSettings />} label="Planung" pathname={pathname!} />
            <SidebarLink href="/produkte" icon={<FiBox />} label="Produkte" pathname={pathname!} />
          </div>
        </nav>

        {/* Profilo in basso */}
        <div className="px-6 pb-6">
          <div className="flex cursor-not-allowed items-center gap-3 text-md text-black opacity-80 select-none">
            <FiUser className="text-xl" />
            <span>Mein Profil</span>
          </div>
        </div>
      </aside>
    </>
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
      className={`relative flex items-center gap-3 rounded-full px-4 py-2 transition-all duration-300
    ${isActive ? "font-semibold text-black" : "text-black hover:text-blue-500"}`}
    >
      {isActive && (
        <span
          className="absolute inset-0 z-[-1] rounded-full border border-white/30
                 bg-blue-200 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.4),inset_-1px_-1px_1px_rgba(0,0,0,0.1)]
                 backdrop-blur-[6px] transition-all duration-300"
        />
      )}
      <span className="text-xl">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
