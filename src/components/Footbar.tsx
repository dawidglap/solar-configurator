"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import {
  FiGrid,
  FiTrendingUp,
  FiZap,
  FiMaximize2,
  FiBarChart2,
  FiDollarSign,
} from "react-icons/fi";
import { BsCircleFill } from "react-icons/bs";

interface Data {
  flaeche?: number;
  stromertrag?: number;
  klasse?: 1 | 2 | 3 | 4;
}

export default function Footbar({ data }: { data: Data }) {
  if (!data) return null;

  const flaeche = data.flaeche ?? 0;
  const spezifischerErtrag =
    data.stromertrag && data.flaeche ? Math.round(data.stromertrag / (data.flaeche * 0.2)) : 0;
  const leistungKwp = parseFloat((flaeche * 0.2).toFixed(1));
  const energiePV = parseFloat((leistungKwp * spezifischerErtrag).toFixed(0));
  const preis = parseFloat((leistungKwp * 97).toFixed(2));
  const flaecheRounded = Math.round(flaeche);




  const klasse = data.klasse ?? 0;
  const classi: Record<number, { label: string; color: string }> = {
    1: { label: "Hervorragend", color: "text-red-500" },
    2: { label: "Mittel", color: "text-yellow-500" },
    3: { label: "Gut", color: "text-orange-400" },
    4: { label: "Sehr gut", color: "text-green-500" },  
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                 bg-white/10 backdrop-blur-lg border border-white/30 shadow-xl 
                 rounded-full px-6 py-2 flex items-center gap-8 text-sm"
    >
      <AnimatedValue icon={<FiGrid />} value={leistungKwp} suffix="kWp" decimals={1} />
      <InfoItem icon={<FiTrendingUp />} label="-- % Ersparnis" />
      <AnimatedValue icon={<FiZap />} value={energiePV} suffix="kWh/Jahr" />
      <AnimatedValue icon={<FiMaximize2 />} value={flaecheRounded} suffix="m²" />
      <AnimatedValue icon={<FiBarChart2 />} value={spezifischerErtrag} suffix="kWh/kWp" />
      <AnimatedValue icon={<FiDollarSign />} value={preis} suffix="CHF" isCHF />

      <div className="flex items-center gap-2 text-black/90 min-w-[120px] text-sm font-medium">
        <BsCircleFill className={`text-sm ${classi[klasse]?.color || ""}`} />
        <span className="whitespace-nowrap">
  {classi[klasse]?.label || "Unbekannt"}
</span>

      </div>
    </motion.div>
  );
}

function AnimatedValue({
  icon,
  value,
  suffix,
  decimals = 0,
  isCHF = false,
}: {
  icon: React.ReactNode;
  value: number;
  suffix: string;
  decimals?: number;
  isCHF?: boolean;
}) {
  const spring = useSpring(0, {
    stiffness: 40,
    damping: 15,
    mass: 1,
    restDelta: 0.001,
  });

  const display = useTransform(spring, (v) =>
    isCHF
      ? v.toLocaleString("de-CH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : v.toFixed(decimals)
  );

  useEffect(() => {
    const delay = setTimeout(() => {
      spring.set(value);
    }, 1000);
    return () => clearTimeout(delay);
  }, [value, spring]);

  return (
    <div className="flex items-center gap-2 text-black/90 min-w-[100px] text-sm font-medium">
      <div className="text-base">{icon}</div>
      <motion.span
  className="inline-block text-right tabular-nums"
  style={{
    minWidth: isCHF ? "70px" : decimals > 0 ? "60px" : "50px",
  }}
>
  {display}
</motion.span>

      <span>{suffix}</span>
    </div>
  );
}

function InfoItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-black/90 min-w-[140px] text-sm font-medium">
      <div className="text-base">{icon}</div>
      <span>{label}</span>
    </div>
  );
}
