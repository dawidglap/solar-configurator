"use client";

import { useEffect, useMemo, useState } from "react";
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

const W_COLLAPSED = 0;   // px (w-0) — solo freccia
const W_EXPANDED  = 56;  // px (w-12) — solo icone

export default function Sidebar() {
  const pathname = usePathname();
  const isPlannerV2 = pathname?.startsWith("/planner-v2") ?? false;

  const [collapsed, setCollapsed] = useState<boolean>(isPlannerV2);
  useEffect(() => { setCollapsed(isPlannerV2); }, [isPlannerV2]);

  useEffect(() => {
    const w = collapsed ? W_COLLAPSED : W_EXPANDED;
    document.body?.style.setProperty('--sb', `${w}px`);
    // Collassata: piccolo overlap (adatta se serve)
    document.body?.style.setProperty('--panel-gap', collapsed ? '-24px' : '8px');

    return () => {
      document.body?.style.removeProperty('--sb');
      document.body?.style.removeProperty('--panel-gap');
    };
  }, [collapsed]);

  const items = useMemo(
    () => [
      { href: "/",          icon: <FiHome /> },
      { href: "/kunden",    icon: <FiUsers /> },
      { href: "/auftraege", icon: <FiClipboard /> },
      { href: "/umsatz",    icon: <FiBarChart2 /> },
      { href: "/aufgaben",  icon: <FiBell /> },
      { href: "/planner-v2",   icon: <FiSettings /> },
      { href: "/produkte",  icon: <FiBox /> },
    ],
    []
  );

  return (
    <>
     {isPlannerV2 && (
  <button
    aria-label={collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"}
    title={collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"}
    onClick={() => setCollapsed((s) => !s)}
    // ⬇️ posizionato più in basso e ancora più a sinistra
    style={{
      left: collapsed ? 6 : `calc(var(--sb, ${W_EXPANDED}px) - 26px)`,
      bottom: 40,
    }}
    className="fixed z-[999360]
               flex h-10 w-10 items-center justify-center rounded-full
               border border-neutral-900 bg-neutral-800/95 text-white
               shadow-lg shadow-black/30
               hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20
               transition"
  >
    {collapsed ? (
      <FiChevronRight className="text-white/95" />
    ) : (
      <FiChevronLeft className="text-white/95" />
    )}
  </button>
)}


      <aside
        className={[
          "fixed left-0 top-0 z-50 flex h-dvh flex-col justify-between border-r border-black/5",
          "bg-white text-black shadow-xl backdrop-blur-xs transition-[width] duration-300 overflow-hidden",
          collapsed ? "w-0" : "w-14",
        ].join(" ")}
      >
        {/* Navigation */}
        <nav className="px-2 pt-4">
          {/* Logo compatto: solo iniziale */}
          <div className="mb-6 select-none font-black tracking-tight flex items-center justify-center">
            <span className="text-xl leading-none">S</span>
          </div>

          {/* Menu: solo icone */}
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.href}>
                <SidebarLink
                  href={it.href}
                  icon={it.icon}
                  pathname={pathname ?? "/"}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* Profilo in basso: solo icona */}
        <div className="px-2 pb-4">
          <div
            className={[
              "flex items-center justify-center rounded-full p-2 text-sm text-black/80 select-none",
            ].join(" ")}
          >
            <FiUser className="text-xl" />
          </div>
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  href,
  icon,
  pathname,
}: {
  href: string;
  icon: React.ReactNode;
  pathname: string;
}) {
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={[
        "group relative flex items-center justify-center rounded-full p-2 text-sm transition-colors",
        isActive ? "font-semibold text-black" : "text-black hover:text-blue-600",
      ].join(" ")}
    >
      {isActive && (
        <span
          className="absolute inset-0 -z-10 rounded-full border border-black/10
                     bg-blue-200/70 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)]
                     backdrop-blur-sm"
        />
      )}
      <span className="text-xl">{icon}</span>
    </Link>
  );
}
