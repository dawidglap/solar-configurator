"use client";

import { useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  onSelectLocation: (lat: number, lon: number) => void;
};

export default function AddressSearch({ onSelectLocation }: Props) {
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
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="absolute top-4 left-4 bg-white p-4 shadow-md z-[1000] rounded-lg w-80"
    >
      <input
        type="text"
        placeholder="Inserisci indirizzo"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full border px-3 py-2 rounded mb-2"
      />

      <button
        onClick={handleSearch}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 flex justify-center items-center gap-2"
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

      <AnimatePresence>
        {results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.3 }}
            className="mt-2 space-y-1 max-h-40 overflow-y-auto"
          >
            {results.map((place, index) => (
              <li
                key={index}
                onClick={() => {
                  onSelectLocation(Number(place.lat), Number(place.lon));
                  setResults([]);
                }}
                className="cursor-pointer hover:bg-gray-100 p-2 rounded"
              >
                {place.display_name}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
