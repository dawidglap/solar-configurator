"use client";

import { useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  onSelectLocation: (lat: number, lon: number) => void;
};

export default function Navbar({ onSelectLocation }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query) return;

    setLoading(true);
    try {
      const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: {
          q: query,
          countrycodes: "ch",
          format: "json",
          addressdetails: 1,
          limit: 5,
        },
      });

      setResults(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 w-full h-16 px-4 z-50
      flex items-center justify-between 
      backdrop-blur-lg bg-white/30 border-b border-white/20 shadow-md">
      
      {/* Titolo */}
      <span className="font-semibold text-black text-lg pl-64">Timeline / Indirizzo</span>

      {/* Ricerca */}
      <div className="relative">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Cerca indirizzo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-72 px-4 py-2 rounded-lg border border-white/30 bg-white/70 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            {loading ? (
              <motion.div
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            ) : (
              "Cerca"
            )}
          </button>
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3 }}
              className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-md shadow-lg w-[300px] max-h-60 overflow-y-auto z-50"
            >
              {results.map((place, index) => (
                <li
                  key={index}
                  onClick={() => {
                    onSelectLocation(Number(place.lat), Number(place.lon));
                    setResults([]);
                    setQuery(place.display_name);
                  }}
                  className="cursor-pointer hover:bg-gray-100 px-4 py-2 text-sm text-black"
                >
                  {place.display_name}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
