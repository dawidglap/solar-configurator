// src/app/ausfuehrung/page.tsx
"use client";

import { useMemo, useState } from "react";
import { FiSearch } from "react-icons/fi";

type PersonItem = {
  id: string;
  name: string;
  city: string;
};

export default function AusfuehrungPage() {
  const [q, setQ] = useState("");

  const people = useMemo<PersonItem[]>(
    () =>
      Array.from({ length: 14 }).map((_, i) => ({
        id: String(i + 1),
        name: "Martin Müller",
        city: "9435 Heerbrugg",
      })),
    []
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(s) || p.city.toLowerCase().includes(s)
    );
  }, [q, people]);

  return (
    <div
      className="w-full"
      style={{
        paddingLeft: "var(--sb, 224px)",
        paddingRight: "0px",
        paddingTop: "0px",
        paddingBottom: "0px",
      }}
    >
      <div className="flex h-[calc(100dvh-0px)] w-full">
        {/* Left rail (più piccola) */}
        <aside
          className={[
            "w-[260px] shrink-0",
            "border-r border-white/10 bg-white/5 backdrop-blur-lg",
            "shadow-[0_0_25px_rgba(0,0,0,0.35)]",
          ].join(" ")}
        >
          <div className="p-3">
            {/* Search (più piccolo) */}
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Suchen"
                className={[
                  "w-full rounded-full border border-white/25 bg-white/10",
                  "px-3 py-2 pr-9 text-[13px] text-white/90 placeholder:text-white/60",
                  "outline-none focus:ring-2 focus:ring-white/20 backdrop-blur-xl",
                ].join(" ")}
              />
              <FiSearch className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/75" />
            </div>

            {/* List (cards più compatte) */}
            <div className="mt-3 space-y-2 overflow-auto pr-1">
              {filtered.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  className={[
                    "w-full text-left",
                    "rounded-lg border bg-white/10 backdrop-blur-xl",
                    "px-3 py-3 text-white/90",
                    "shadow-[0_0_14px_rgba(0,0,0,0.22)]",
                    idx === 0 ? "border-rose-300/45" : "border-white/25",
                    "hover:border-white/40 transition",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] leading-none">{p.name}</div>
                    <div className="text-[12px] leading-none text-white/75">
                      {p.city}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right calendar grid */}
        <main className="flex-1 overflow-auto px-10 py-6">
          {/* Header line (subtle) */}
          <div className="mb-4 flex items-center justify-center gap-10 text-white/85">
            <div className="text-[16px]">Jahr</div>
            <div className="text-[16px]">2025</div>
          </div>

          {/* Calendar grid: più spazio tra mesi */}
          <div className="grid grid-cols-1 gap-x-16 gap-y-14 md:grid-cols-2 xl:grid-cols-4">
            {[
              "Januar",
              "Februar",
              "März",
              "April",
              "Mai",
              "Juni",
              "Juli",
              "August",
              "September",
              "Oktober",
              "November",
              "Dezember",
            ].map((m, i) => (
              <MiniMonth key={m} title={m} seed={i + 1} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

/* -------------------- mini calendar (più piccolo) -------------------- */

function MiniMonth({ title, seed }: { title: string; seed: number }) {
  const week = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const daysInMonth = 31;
  const startOffset = (seed * 2) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="min-w-[200px]">
      {/* Month title */}
      <div className="mb-2 text-center text-[15px] text-white/85">{title}</div>

      {/* Week header (più piccolo) */}
      <div className="grid grid-cols-7 gap-x-3 gap-y-1 text-[12px]">
        {week.map((w) => (
          <div
            key={w}
            className={[
              "text-center",
              w === "Su" ? "text-rose-300/80" : "text-white/70",
            ].join(" ")}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Days (più piccolo + domeniche quasi rosse) */}
      <div className="mt-2 grid grid-cols-7 gap-x-3 gap-y-1 text-[12px]">
        {cells.map((d, idx) => {
          const isSunday = idx % 7 === 0;
          return (
            <div
              key={idx}
              className={[
                "h-5 text-center leading-5",
                d ? "text-white/85" : "text-transparent",
                isSunday && d ? "text-rose-300/80" : "",
              ].join(" ")}
            >
              {d ?? "0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
