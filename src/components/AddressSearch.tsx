"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { FiSearch, FiMapPin } from "react-icons/fi";


import { FaLocationArrow } from "react-icons/fa6";

type Props = {
  onSelectLocation: (lat: number, lon: number) => void;
};

export default function AddressSearch({ onSelectLocation }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSearch = useCallback(async () => {
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
      setActiveIndex(-1);
      setShowSuggestions(true); // mostra suggerimenti
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const delay = setTimeout(() => {
      if (query.length > 2) handleSearch();
    }, 300);
    return () => clearTimeout(delay);
  }, [query, handleSearch]);

  useEffect(() => {
  const handleClickOutside = () => {
    setShowSuggestions(false);
  };

  // aggiungiamo listener globale
  window.addEventListener("click", handleClickOutside);

  // cleanup
  return () => {
    window.removeEventListener("click", handleClickOutside);
  };
}, []);


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter" && results.length > 0) {
      const selected = activeIndex >= 0 ? results[activeIndex] : results[0];
      selectLocation(selected);
    }
  };

  const selectLocation = (place: any) => {
    onSelectLocation(Number(place.lat), Number(place.lon));
    setQuery(place.display_name);     // mostra il testo selezionato
    setResults([]);                   // svuota risultati
    setShowSuggestions(false);        // chiude suggerimenti
  };

  const formatLabel = (displayName: string) => {
    const parts = displayName.split(",").map((part) => part.trim());
    const title = parts.slice(0, 1).join(", ");
    const subtitle = parts.slice(1).join(", ");
    return { title, subtitle };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="absolute top-4 left-[calc(50%+17rem)] -translate-x-1/2 z-[1000] w-[480px]"
       onClick={(e) => e.stopPropagation()}
    >
      {/* Search bar */}
      <div
  className="relative flex items-center rounded-full px-4 py-2
             bg-gradient-to-br from-white/30 to-white/10
             backdrop-blur-sm border border-white/30
             shadow-[inset_1px_1px_4px_rgba(255,255,255,0.4),_inset_-1px_-1px_4px_rgba(0,0,0,0.05)]"
>
  <FiSearch className="text-gray-600 text-xl mr-3" />
  <input
    type="text"
    placeholder="Los geht’s: Wie lautet deine Adresse?"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    onKeyDown={handleKeyDown}
    className="flex-1 bg-transparent text-black placeholder-gray-700 focus:outline-none"
    onClick={(e) => e.stopPropagation()}
  />

  <div className="relative group">
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (results.length > 0) {
          selectLocation(results[0]);
          setShowSuggestions(false);
        }
      }}
      className="ml-3 p-2 rounded-full 
                 bg-gradient-to-br from-white/30 to-white/10
                 text-black 
                 border border-white/30 
                 backdrop-blur-md 
                 hover:from-white/40 hover:to-white/20
                 shadow-[inset_1px_1px_4px_rgba(255,255,255,0.4),_inset_-1px_-1px_4px_rgba(0,0,0,0.05)]
                 transition-all duration-300"
    >
      <FaLocationArrow className="text-sm" />
    </button>

    {/* Tooltip */}
    <div
      className="absolute -top-8 left-1/2 -translate-x-1/2 
                 px-2 py-0.5 text-[10px] rounded-full 
                 bg-white/50 backdrop-blur-md text-black font-semibold
                 border border-white/30 shadow 
                 opacity-0 group-hover:opacity-100 
                 transition-all duration-300 pointer-events-none"
    >
      Suchen
    </div>
  </div>
</div>


      {/* Suggerimenti */}
    <AnimatePresence>
  {showSuggestions && (
    <motion.ul
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="mt-2 rounded-xl bg-white/30 backdrop-blur-lg border border-white/20 shadow-xl overflow-hidden"
    >
      {results.map((place, index) => {
        const { title, subtitle } = formatLabel(place.display_name);
        return (
          <li
            key={index}
            onClick={() => {
              selectLocation(place);
              setShowSuggestions(false);
            }}
            className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition ${
              index === activeIndex ? "bg-white/40" : "hover:bg-white/20"
            }`}
          >
            <FiMapPin className="mt-1 text-lg text-gray-600 flex-shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-black">{title}</div>
              <div className="text-gray-700">{subtitle}</div>
            </div>
          </li>
        );
      })}
    </motion.ul>
  )}
</AnimatePresence>

    </motion.div>
  );
}
