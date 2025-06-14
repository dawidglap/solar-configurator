"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MousePointerClick,
  Grid3x3,
  SquareDashedBottom,
  RotateCcw,
  Eraser,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";

export function Toolbar({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const buttons = [
    { value: "single", icon: <MousePointerClick className="h-5 w-5" />, label: "Einzel" },
    { value: "fill", icon: <Grid3x3 className="h-5 w-5" />, label: "Füllen" },
    { value: "select", icon: <SquareDashedBottom className="h-5 w-5" />, label: "Auswählen" },
    { value: "rotate", icon: <RotateCcw className="h-5 w-5" />, label: "Drehen" },
    { value: "delete", icon: <Eraser className="h-5 w-5" />, label: "Löschen" },
    { value: "deleteAll", icon: <Trash2 className="h-5 w-5" />, label: "Alle Löschen" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="fixed top-20 right-6 z-[999] p-3 flex flex-col items-center gap-3 rounded-full backdrop-blur-xl bg-white/10 border border-white/30 shadow-2xl"
    >
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={onChange}
        className="flex flex-col gap-2"
      >
        {buttons.map((btn) => (
          <motion.div
            key={btn.value}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="relative group"
          >
            {/* Tooltip */}
            <div
              className="absolute left-[-120%] top-1/2 -translate-y-1/2 
                         px-2 py-0.5 text-[10px] rounded-full 
                         bg-white/50 backdrop-blur-md text-black font-semibold
                         border border-white/30 shadow 
                         opacity-0 group-hover:opacity-100 
                         transition-all duration-300 pointer-events-none"
            >
              {btn.label}
            </div>

            <div className="rounded-full overflow-hidden">
              <ToggleGroupItem
                value={btn.value}
                aria-label={btn.value}
                className="rounded-full w-12 h-12 p-0 flex items-center justify-center 
                  bg-white/20 text-black border border-white/20 
                  hover:bg-white/30 
                  data-[state=on]:bg-white/80 data-[state=on]:backdrop-blur-md 
                  transition-all duration-200"
              >
                {btn.icon}
              </ToggleGroupItem>
            </div>
          </motion.div>
        ))}
      </ToggleGroup>
    </motion.div>
  );
}
