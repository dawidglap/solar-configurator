"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FiHome,
  FiEdit3,
  FiLayers,
  FiUsers,
  FiBarChart2,
  FiUser,
  FiBell,
  FiSettings,
  FiBox,
  FiCloud,
  FiHelpCircle,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";

// “chiusa” = compatta con icone (w-14) | “espansa” = icone + testo (w-56)
const W_COMPACT = 56; // px  (w-14)
const W_EXPANDED = 224; // px  (w-56)

export default function Sidebar() {
  const pathname = usePathname();
  const isPlannerV2 = pathname?.startsWith("/planner-v2") ?? false;

  // 🔹 Nascondi completamente la sidebar sulla pagina di login
  if (pathname === "/login") return null;

  // In planner-v2 parte “chiusa” (compatta), altrove espansa
  const [collapsed, setCollapsed] = useState<boolean>(isPlannerV2);

  useEffect(() => {
    setCollapsed(isPlannerV2);
  }, [isPlannerV2]);

  useEffect(() => {
    const w = collapsed ? W_COMPACT : W_EXPANDED;
    document.body?.style.setProperty("--sb", `${w}px`);
    document.body?.style.setProperty("--panel-gap", collapsed ? "0px" : "8px");

    return () => {
      document.body?.style.removeProperty("--sb");
      document.body?.style.removeProperty("--panel-gap");
    };
  }, [collapsed]);

  // ✅ Ordine + icone come nello screenshot
  const items = useMemo(
    () => [
      { href: "/", label: "Dashboard", icon: <FiHome /> },
      { href: "/auftraege", label: "Projekte", icon: <FiEdit3 /> },
      { href: "/planner-v2", label: "Planungstool", icon: <FiLayers /> },
      { href: "/kunden", label: "Kunden", icon: <FiUsers /> },
      { href: "/umsatz", label: "Statistik", icon: <FiBarChart2 /> },
      { href: "/leads", label: "Leads", icon: <FiUser /> }, // se non esiste ancora, resta placeholder
      { href: "/aufgaben", label: "Aufgaben", icon: <FiBell /> },
      { href: "/ausfuehrung", label: "Ausführung", icon: <FiSettings /> }, // placeholder
      { href: "/produkte", label: "Marktplatz", icon: <FiBox /> },
    ],
    []
  );

  const bottomItems = useMemo(
    () => [
      { href: "/cloud", label: "Cloud", icon: <FiCloud /> }, // placeholder
      { href: "/settings", label: "Settings", icon: <FiSettings /> }, // placeholder
      { href: "/support", label: "Support", icon: <FiHelpCircle /> }, // placeholder
    ],
    []
  );

  return (
    <aside
      className={[
        "fixed left-0 top-0 z-50 flex h-dvh flex-col",
        "border-r border-white/10 bg-white/5 backdrop-blur-lg shadow-[0_0_25px_rgba(0,0,0,0.6)]",
        "transition-[width] duration-300 overflow-hidden",
        collapsed ? "w-14" : "w-56",
      ].join(" ")}
    >
      {/* TOP */}
      <div className="px-2 pt-4">
        {/* Logo: nello screenshot è “sola” */}
        <div className="mb-6 select-none font-black tracking-tight flex items-center justify-center">
          <span className="text-xl leading-none text-white/90">
            {collapsed ? "S" : "sola"}
          </span>
        </div>

        {/* Menu principale */}
        <nav>
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

          {/* Toggle: subito sotto l'ultima icona, SEMPRE A SX */}
          {isPlannerV2 && (
            <div className="mt-2 ">
              <button
                aria-label={
                  collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"
                }
                title={
                  collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"
                }
                onClick={() => setCollapsed((s) => !s)}
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  "border border-white/20 bg-neutral-900/80 text-white",
                  "shadow-lg shadow-black/40 backdrop-blur-md",
                  "hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-white/20",
                  "transition",
                ].join(" ")}
              >
                {collapsed ? (
                  <FiChevronRight className="text-white/95" />
                ) : (
                  <FiChevronLeft className="text-white/95" />
                )}
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* SPACER */}
      <div className="flex-1" />

      {/* BOTTOM (cloud / settings / support) */}
      <div className="px-2 pb-4">
        <ul className="flex flex-col gap-2">
          {bottomItems.slice(0, 2).map((it) => (
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

        {/* Support in fondo come nello screenshot */}
        <div className="mt-3">
          <SidebarLink
            href={bottomItems[2].href}
            icon={bottomItems[2].icon}
            label={bottomItems[2].label}
            pathname={pathname ?? "/"}
            collapsed={collapsed}
          />
        </div>
      </div>
    </aside>
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
        "group relative flex items-center rounded-full text-sm transition-colors",
        collapsed ? "justify-center p-2" : "justify-start px-3 py-2 gap-3",
        isActive
          ? "font-semibold text-white"
          : "text-white/70 hover:text-emerald-300",
      ].join(" ")}
    >
      {isActive && (
        <span
          className={[
            "absolute inset-0 -z-10 rounded-full border border-emerald-300/70",
            "bg-emerald-400/30 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)]",
            "backdrop-blur-sm",
          ].join(" ")}
        />
      )}

      <span className="text-xl shrink-0">{icon}</span>

      {!collapsed && (
        <span className="text-[13px] leading-none text-white/85">{label}</span>
      )}
    </Link>
  );
}
