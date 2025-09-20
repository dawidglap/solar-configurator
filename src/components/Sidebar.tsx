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

const W_COLLAPSED = 64;   // px (w-16)
const W_EXPANDED  = 224;  // px (w-56)

export default function Sidebar() {
  const pathname = usePathname();
  const isPlannerV2 = pathname?.startsWith("/planner-v2") ?? false;

  const [collapsed, setCollapsed] = useState<boolean>(isPlannerV2);
  useEffect(() => { setCollapsed(isPlannerV2); }, [isPlannerV2]);

useEffect(() => {
  const w = collapsed ? W_COLLAPSED : W_EXPANDED;
  document.body?.style.setProperty('--sb', `${w}px`);

  // Gap del pannello rispetto al bordo SINISTRO del contenitore (già shiftato da --sb)
  // Collassata: sovrapponi un po' (negativo). Espansa: un piccolo margine positivo.
  document.body?.style.setProperty('--panel-gap', collapsed ? '-68px' : '8px');

  return () => {
    document.body?.style.removeProperty('--sb');
    document.body?.style.removeProperty('--panel-gap');
  };
}, [collapsed]);



  const items = useMemo(
    () => [
      { href: "/",          icon: <FiHome />,      label: "Home" },
      { href: "/kunden",    icon: <FiUsers />,     label: "Kunden" },
      { href: "/auftraege", icon: <FiClipboard />, label: "Aufträge" },
      { href: "/umsatz",    icon: <FiBarChart2 />, label: "Umsatz" },
      { href: "/aufgaben",  icon: <FiBell />,      label: "Aufgaben" },
      { href: "/planung",   icon: <FiSettings />,  label: "Planung" },
      { href: "/produkte",  icon: <FiBox />,       label: "Produkte" },
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
          className="fixed left-[calc(var(--sb,64px)_-_18px)] top-2/3 z-[999360] -translate-y-1/2
                     flex h-9 w-9 items-center justify-center rounded-full border border-black/10
                     bg-neutral-700 shadow hover:bg-black transition"
        >
          {collapsed ? <FiChevronRight className="text-white" /> : <FiChevronLeft className="text-white" />}
        </button>
      )}

      <aside
        className={[
          "fixed left-0 top-0 z-50 flex h-dvh flex-col justify-between border-r border-black/5",
          "bg-white text-black shadow-xl backdrop-blur-xs transition-[width] duration-300",
          collapsed ? "w-16" : "w-56",
        ].join(" ")}
      >
        {/* Navigation */}
        <nav className="px-3 pt-5">
          {/* Logo */}
          <div className="mb-8 select-none font-black tracking-tight flex items-center justify-center ">
            {collapsed ? (
              <span className="text-xl leading-none">S</span>
            ) : (
              <span className="ms-2 text-3xl leading-none">SOLA</span>
            )}
          </div>

          {/* Menu */}
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.href}>
                <SidebarLink
                  href={it.href}
                  icon={it.icon}
                  label={it.label}
                  pathname={pathname ?? "/"}
                  collapsed={collapsed}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* Profilo in basso */}
        <div className="px-3 pb-4">
          <div
            className={[
              "flex items-center rounded-full px-3 py-2 text-sm text-black/80 select-none",
              collapsed ? "justify-center gap-0" : "gap-3",
            ].join(" ")}
          >
            <FiUser className="text-xl" />
            {!collapsed && <span>Mein Profil</span>}
          </div>
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  pathname,
  collapsed,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  pathname: string;
  collapsed: boolean;
}) {
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={[
        "group relative flex items-center rounded-full px-3 py-2 text-sm transition-colors",
        isActive ? "font-semibold text-black" : "text-black hover:text-blue-600",
        collapsed ? "justify-center gap-0" : "gap-3",
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
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </Link>
  );
}
