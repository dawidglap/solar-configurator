"use client";

import { useState, useEffect } from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiBattery,
  FiBox,
  FiGrid,
  FiZap,
  FiCpu,
  FiSettings,
  FiThermometer,
  FiSliders,
} from "react-icons/fi";
import { FaChevronDown } from "react-icons/fa";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const items = [
  { label: "Module", icon: <FiGrid />, options: ["Mustermodul 1", "Mustermodul 2"] },
  { label: "Speicher", icon: <FiBattery />, options: ["5 kWh", "10 kWh"] },
  { label: "Ladestation", icon: <FiZap />, options: ["Wallbox A", "Wallbox B"] },
  { label: "Wechselrichter", icon: <FiCpu />, options: ["Huawei", "Fronius"] },
  { label: "Optimierer", icon: <FiSettings />, options: ["Tigo", "SolarEdge"] },
  { label: "Backup Box", icon: <FiBox />, options: ["Standard", "Premium"] },
  { label: "Boileranst.", icon: <FiThermometer />, options: ["100L", "200L"] },
];

type PlanningParams = {
  targetKwp: number;
  margin: number;
  spacing: number;
   orientation: "portrait" | "landscape"; 
   excludePoor: boolean; // ⬅️ nuovo
};

export default function PlannerSidebar({
  visible,
  params,
  onChangeParams,
}: {
  visible: boolean;
  params: PlanningParams;
  onChangeParams: (p: PlanningParams) => void;
}) {
  const [show, setShow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const [selections, setSelections] = useState<{ [key: string]: string }>(
    Object.fromEntries(items.map((i) => [i.label, i.options[0]]))
  );

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (!show) return null;

  return (
    <motion.div
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeIn" }}
      className={cn(
        "fixed top-0 left-52 h-full z-40 flex transition-all",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div
        className="relative h-full w-full px-3 pt-[98px] pb-6 flex flex-col items-center gap-3
                   bg-neutral-50 backdrop-blur-sm border-l border-white/30 shadow-xl"
      >
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="absolute top-6 -right-4 w-7 h-7 rounded-full bg-blue-100 backdrop-blur-sm
                     border border-white/20 shadow flex items-center justify-center hover:bg-blue-300 transition"
        >
          {collapsed ? <FiChevronRight className="text-black w-4 h-4" /> : <FiChevronLeft className="text-black w-4 h-4" />}
        </button>

        {!collapsed && (
          <div className="w-full rounded-xl bg-neutral-50 border border-white/40 shadow-inner p-3 mb-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-black mb-2">
              <FiSliders />
              <span>Planungs-Parameter</span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <label className="text-black/80">Target</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={params.targetKwp}
                    onChange={(e) =>
                      onChangeParams({ ...params, targetKwp: Number(e.target.value) })
                    }
                    className="w-20 text-right rounded-md bg-white/70 border border-white/50 px-2 py-1 focus:outline-none"
                  />
                  <span className="text-black/70">kWp</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-black/80">Margine</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={params.margin}
                    onChange={(e) =>
                      onChangeParams({ ...params, margin: Number(e.target.value) })
                    }
                    className="w-20 text-right rounded-md bg-white/70 border border-white/50 px-2 py-1 focus:outline-none"
                  />
                  <span className="text-black/70">m</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-black/80">Spaziatura</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={params.spacing}
                    onChange={(e) =>
                      onChangeParams({ ...params, spacing: Number(e.target.value) })
                    }
                    className="w-20 text-right rounded-md bg-white/70 border border-white/50 px-2 py-1 focus:outline-none"
                  />
                  <span className="text-black/70">m</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
  <label className="text-black/80">Escludi zone scadenti</label>
  <input
    type="checkbox"
    checked={params.excludePoor}
    onChange={(e) => onChangeParams({ ...params, excludePoor: e.target.checked })}
    className="w-4 h-4"
  />
</div>

              <div className="mt-2">
  <label className="block text-xs text-black/70 mb-1">Orientamento</label>
  <select
    value={params.orientation}
    onChange={(e) =>
      onChangeParams({ ...params, orientation: e.target.value as "portrait" | "landscape" })
    }
    className="w-[90%] rounded-full bg-blue-100 backdrop-blur-md border border-white/30
               pl-4 pr-8 py-1.5 text-sm font-semibold text-black shadow-inner
               hover:bg-blue-300 focus:outline-none focus:ring-2 focus:ring-white/40"
  >
    <option value="portrait" className="text-black bg-white">Portrait (verticale)</option>
    <option value="landscape" className="text-black bg-white">Landscape (orizzontale)</option>
  </select>
</div>

            </div>
          </div>
        )}

        <div className="flex-1 w-full flex flex-col gap-3">
          {items.map(({ label, icon, options }) => (
            <div key={label} className="flex flex-col gap-1 relative group">
              {collapsed ? (
                <>
                  <div className="w-10 h-10 mx-auto flex items-center justify-center 
                                  bg-white border border-white/30 rounded-full 
                                  backdrop-blur-sm text-black shadow transition hover:bg-blue-300">
                    {icon}
                  </div>
                  <div className="absolute left-12 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] rounded-full 
                                  bg-white/50 backdrop-blur-sm text-black font-semibold border border-white/30 shadow 
                                  opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-50">
                    {label}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-light text-black mb-1 px-1">
                    <span className="text-base">{icon}</span>
                    <span>{label}</span>
                  </div>
                  <div className="relative w-[90%] mx-auto">
                    <select
                      value={selections[label]}
                      onChange={(e) =>
                        setSelections((prev) => ({ ...prev, [label]: e.target.value }))
                      }
                      className="w-full appearance-none rounded-full bg-blue-100 backdrop-blur-md
                                 border border-white/30 pl-4 pr-8 py-1.5 text-sm font-semibold
                                 text-black shadow-inner hover:bg-blue-300 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-white/40"
                    >
                      {options.map((opt) => (
                        <option key={opt} value={opt} className="text-black bg-white">
                          {opt}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black text-sm">
                      <FaChevronDown />
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
