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

export default function PlannerSidebar({ visible }: { visible: boolean }) {
  const [show, setShow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selections, setSelections] = useState<{ [key: string]: string }>(
    Object.fromEntries(items.map((i) => [i.label, i.options[0]]))
  );

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setShow(true), 3000); // 3 sec delay
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
                   bg-white/50 backdrop-blur-sm border-l border-white/30 shadow-xl"
      >
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="absolute top-6 -right-4 w-7 h-7 rounded-full bg-white/30 backdrop-blur-sm
                     border border-white/20 shadow flex items-center justify-center hover:bg-white/40 transition"
        >
          {collapsed ? (
            <FiChevronRight className="text-black w-4 h-4" />
          ) : (
            <FiChevronLeft className="text-black w-4 h-4" />
          )}
        </button>

        <div className="flex-1 w-full flex flex-col gap-3">
          {items.map(({ label, icon, options }) => (
            <div key={label} className="flex flex-col gap-1 relative group">
              {collapsed ? (
                <>
                  <div className="w-10 h-10 mx-auto flex items-center justify-center 
                                  bg-white/20 border border-white/30 rounded-full 
                                  backdrop-blur-sm text-black shadow transition hover:bg-white/30">
                    {icon}
                  </div>
                  <div
                    className="absolute left-12 top-1/2 -translate-y-1/2 
                               px-2 py-0.5 text-[10px] rounded-full 
                               bg-white/50 backdrop-blur-sm text-black font-semibold
                               border border-white/30 shadow 
                               opacity-0 group-hover:opacity-100 
                               transition-all duration-300 pointer-events-none z-50"
                  >
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
      setSelections((prev) => ({
        ...prev,
        [label]: e.target.value,
      }))
    }
    className="w-full appearance-none rounded-full bg-white/30 backdrop-blur-md
               border border-white/30 pl-4 pr-8 py-1.5 text-sm font-semibold
               text-black shadow-inner hover:bg-white/40 transition-colors
               focus:outline-none focus:ring-2 focus:ring-white/40"
  >
    {options.map((opt) => (
      <option key={opt} value={opt} className="text-black bg-white">
        {opt}
      </option>
    ))}
  </select>
  {/* Freccia custom con posizione assoluta */}
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
