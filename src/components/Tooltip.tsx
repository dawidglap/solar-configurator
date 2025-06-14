// components/Tooltip.tsx
"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export default function Tooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="relative group inline-block">
      {children}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-[2px] text-[10px]
                   rounded-full border border-white/20 backdrop-blur-lg bg-white/10
                   text-black shadow pointer-events-none opacity-0 group-hover:opacity-100"
      >
        {label}
      </motion.div>
    </div>
  );
}
