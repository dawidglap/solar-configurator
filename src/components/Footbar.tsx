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
import type { RoofAttributes } from "@/types/roof";

export default function Footbar({
  data,
  modsStats,
}: {
  data: RoofAttributes[];
  modsStats?: { count: number; areaPlan: number };
}) {
  if (!data || data.length === 0) return null;

  const totalFlaeche = data.reduce<number>((sum, item) => sum + Number(item.flaeche ?? 0), 0);
const totalStromertrag = data.reduce<number>((sum, item) => sum + Number(item.stromertrag ?? 0), 0);

  const spezifischerErtrag =
    totalStromertrag && totalFlaeche ? Math.round(totalStromertrag / (totalFlaeche * 0.2)) : 0;

  const leistungKwp = parseFloat((totalFlaeche * 0.2).toFixed(1));
  const energiePV = parseFloat((leistungKwp * spezifischerErtrag).toFixed(0));
  const preis = parseFloat((leistungKwp * 97).toFixed(2));
  const flaecheRounded = Math.round(totalFlaeche);
  const kwpPerModulo = 0.4; // MVP: 400 W/modulo
const kwpDaModuli = (modsStats?.count ?? 0) * kwpPerModulo;


  // Trova la classe più comune tra i tetti selezionati
// Trova la classe più comune tra i tetti selezionati
const classCounter = data.reduce((acc: Record<number, number>, item) => {
  const raw = item.klasse as unknown; // potrebbe essere string/number/undefined
  const cls =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
      ? parseInt(raw, 10)
      : NaN;

  if (!Number.isNaN(cls)) {
    acc[cls] = (acc[cls] ?? 0) + 1;
  }
  return acc;
}, {} as Record<number, number>); // ← importante: cast dell'oggetto iniziale

const mostCommonClass =
  Number(
    Object.entries(classCounter).sort((a, b) => b[1] - a[1])[0]?.[0]
  ) || 0;


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
                 bg-white backdrop-blur-lg border border-white/30 shadow-xl 
                 rounded-full px-6 py-2 flex items-center gap-8 text-sm"
    >
      <InfoItem
  icon={<FiGrid />}
  label={`${modsStats?.count ?? 0} moduli • ${kwpDaModuli.toFixed(1)} kWp`}
/>

      <InfoItem icon={<FiTrendingUp />} label="-- % Ersparnis" />
      <AnimatedValue icon={<FiZap />} value={energiePV} suffix="kWh/Jahr" />
      <AnimatedValue icon={<FiMaximize2 />} value={flaecheRounded} suffix="m²" />
      <AnimatedValue icon={<FiBarChart2 />} value={spezifischerErtrag} suffix="kWh/kWp" />
      <AnimatedValue icon={<FiDollarSign />} value={preis} suffix="CHF" isCHF />

      <div className="flex items-center gap-2 text-black/90 min-w-[120px] text-sm font-medium">
        <BsCircleFill className={`text-sm ${classi[mostCommonClass]?.color || ""}`} />
        <span className="whitespace-nowrap">
          {classi[mostCommonClass]?.label || "Unbekannt"}
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
