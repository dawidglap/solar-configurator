"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type SolaTheme = "default" | "light" | "dark";

const THEMES: { value: SolaTheme; label: string; Icon: typeof Monitor }[] = [
  { value: "default", label: "Default", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
];

function applyTheme(theme: SolaTheme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme !== "light");
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  localStorage.setItem("sola-theme", theme);
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<SolaTheme>("default");

  useEffect(() => {
    const stored = localStorage.getItem("sola-theme") as SolaTheme | null;
    const next =
      stored === "light" || stored === "dark" || stored === "default"
        ? stored
        : "default";
    setTheme(next);
    applyTheme(next);
  }, []);

  return (
    <div className="theme-switcher pointer-events-auto inline-flex h-7 items-center rounded-lg p-0.5">
      {THEMES.map(({ value, label, Icon }) => {
        const active = value === theme;
        return (
          <button
            key={value}
            type="button"
            aria-label={`Theme: ${label}`}
            title={label}
            onClick={() => {
              setTheme(value);
              applyTheme(value);
            }}
            className={[
              "theme-switcher-btn inline-flex h-6 w-7 items-center justify-center rounded-md transition",
              active ? "theme-switcher-btn--active" : "",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
