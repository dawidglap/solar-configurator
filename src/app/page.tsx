"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import { FaArrowRight } from "react-icons/fa";

export default function Home() {
  const router = useRouter();

  return (
    <main className="ms-52 relative min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-3xl rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl p-10"
      >
        {/* Header + Icona */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {/* <Sun className="text-yellow-400 w-8 h-8" /> */}
            <h1 className="text-2xl font-bold tracking-tight">Willkommen bei SOLA</h1>
          </div>
        </div>

        {/* Sottotitolo */}
        <p className="text-white/90 text-lg mb-6">
          Dein digitaler Einstieg in die <strong>zukünftige Energieplanung</strong>.
          Konfiguriere dein persönliches Energiebudget und entdecke, wie viel du sparen kannst.
        </p>

        {/* Bullet List */}
        <ul className="space-y-3 mb-8">
          {[
            "Inklusive Solaranlage, Batteriespeicher und Elektroauto",
            "Wirtschaftlichkeitsanalyse & Amortisierung",
            "CO₂-Ersparnis und Umweltvorteile",
          ].map((text, idx) => (
            <li key={idx} className="flex items-start gap-2 text-white/95">
              <CheckCircle className="w-5 h-5 text-green-400 mt-1" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        {/* Bottone Lucid Glass con animazione */}
        <div className="flex justify-center">
          <motion.button
            onClick={() => router.push("/planung")}
            className="cursor-pointer group px-8 py-3 text-lg font-semibold rounded-full
                       bg-white/10 backdrop-blur-md text-white flex items-center gap-3
                       border border-white/30 shadow-xl hover:bg-white/20 transition-all duration-300"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
       
            Jetzt starten 
                 <motion.div
              className="text-white"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <FaArrowRight className="w-5 h-5" />
            </motion.div>
          </motion.button>
        </div>
      </motion.div>
    </main>
  );
}
