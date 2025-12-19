// src/app/umsatz/page.tsx
"use client";

import { useMemo } from "react";

type LegendItem = { label: string; dotClass: string };
type Month = { label: string; stacks: number[] }; // 8 categorie

export default function UmsatzPage() {
  const person = "Edin Mustafic";
  const range = "01.01.2025 - 31.12.2025";

  // ordine come nello screenshot
  const legend = useMemo<LegendItem[]>(
    () => [
      { label: "Leads", dotClass: "bg-cyan-200" },
      { label: "Termine", dotClass: "bg-slate-300" },
      { label: "Junk", dotClass: "bg-fuchsia-700" },
      { label: "Gelöscht", dotClass: "bg-pink-400" },
      { label: "Offeriert", dotClass: "bg-yellow-300" },
      { label: "Gewonnen", dotClass: "bg-emerald-400" },
      { label: "Verloren", dotClass: "bg-rose-400" },
      { label: "Kunden", dotClass: "bg-violet-700" },
    ],
    []
  );

  // placeholder dataset (visivamente simile allo screenshot)
  // stacks = [Leads, Termine, Junk, Gelöscht, Offeriert, Gewonnen, Verloren, Kunden]
  const months = useMemo<Month[]>(
    () => [
      { label: "Jan.", stacks: [6, 10, 6, 2, 4, 2, 8, 4] },
      { label: "Feb.", stacks: [12, 10, 4, 2, 8, 2, 8, 4] },
      { label: "März", stacks: [14, 12, 5, 2, 10, 3, 10, 4] },
      { label: "Apr.", stacks: [22, 28, 4, 2, 6, 3, 10, 5] },
      { label: "Mai", stacks: [6, 24, 6, 2, 4, 2, 8, 4] },
      { label: "Juni", stacks: [8, 8, 4, 2, 4, 3, 8, 4] },
      { label: "Juli", stacks: [4, 4, 4, 2, 2, 2, 10, 6] },
      { label: "Aug.", stacks: [10, 12, 4, 2, 4, 2, 6, 6] },
      { label: "Sept.", stacks: [12, 20, 4, 2, 3, 2, 8, 4] },
      { label: "Okt.", stacks: [4, 6, 4, 2, 2, 2, 8, 5] },
      { label: "Nov.", stacks: [12, 20, 4, 2, 3, 2, 8, 4] },
      { label: "Dez.", stacks: [18, 26, 4, 2, 3, 2, 7, 4] },
    ],
    []
  );

  // calcolo max per scaling in altezza
  const maxTotal = useMemo(() => {
    return Math.max(...months.map((m) => m.stacks.reduce((a, b) => a + b, 0)));
  }, [months]);

  return (
    <div
      className="w-full"
      style={{
        paddingLeft: "calc(var(--sb, 224px) + 32px)",
        paddingRight: "32px",
        paddingTop: "26px",
        paddingBottom: "28px",
      }}
    >
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[34px] font-light tracking-tight text-white/90">
          Sales Controlling
        </h1>

        <div className="mt-2 flex items-center justify-between">
          <div className="text-[18px] font-medium text-emerald-200/80">
            {person}
          </div>
          <div className="text-[16px] text-emerald-200/70">{range}</div>
        </div>
      </div>

      {/* Big chart card */}
      <div className="rounded-2xl border border-white/25 bg-white/10 backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.35)] ring-1 ring-white/10">
        <div className="rounded-2xl border border-white/15 p-6">
          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-2">
            {legend.map((l) => (
              <div key={l.label} className="flex items-center gap-3">
                <span className={`h-4 w-4 rounded-full ${l.dotClass}`} />
                <span className="text-[18px] text-white/85">{l.label}</span>
              </div>
            ))}
          </div>

          {/* Plot area */}
          <div className="mt-4 grid grid-cols-[56px_1fr] gap-4">
            {/* Y axis */}
            <div className="relative">
              <div className="absolute inset-0 flex flex-col justify-between pb-7 text-white/85">
                {["100", "80", "60", "40", "20", "0"].map((t) => (
                  <div key={t} className="text-[18px]">
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Bars + gridlines */}
            <div className="relative">
              {/* grid lines */}
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-7">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-px bg-white/10" />
                ))}
              </div>

              <div className="flex items-end justify-between gap-4 px-2 pb-7">
                {months.map((m) => (
                  <StackedBar key={m.label} month={m} maxTotal={maxTotal} />
                ))}
              </div>

              {/* X labels */}
              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[18px] text-white/85">
                {months.map((m) => (
                  <div key={m.label} className="w-[52px] text-center">
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tables */}
      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-[18px] font-medium text-white/90">Sales</h2>
          <div className="space-y-6">
            <RowPill label="Offeriert" pct="100 %" right="2 090 250.00 CHF" />
            <RowPill label="Gewonnen" pct="50 %" right="1 045 125.00 CHF" />
            <RowPill label="Verloren" pct="28.23 %" right="590 250.00 CHF" />
            <RowPill label="Entwurf" pct="21.77 %" right="455 047.42 CHF" />
            <RowPill label="Aufträge" pct="10 %" right="24 Stk." />
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-[18px] font-medium text-white/90">Leads</h2>
          <div className="space-y-6">
            <RowPill label="Leads" pct="100 %" right="240 Stk." />
            <RowPill
              label="Termine"
              pct="50 %"
              mid="(100 %)"
              midClass="text-cyan-200/80"
              right="120 Stk."
            />
            <RowPill label="Junk" pct="29.16 %" right="70 Stk." />
            <RowPill label="Gelöscht" pct="20.83 %" right="50 Stk." />
            <RowPill
              label="Aufträge"
              pct="10 %"
              mid="(21,5 %)"
              midClass="text-rose-300/80"
              right="24 Stk."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- components -------------------- */

function RowPill({
  label,
  pct,
  mid,
  midClass = "text-white/70",
  right,
}: {
  label: string;
  pct: string;
  mid?: string;
  midClass?: string;
  right: string;
}) {
  return (
    <div className="rounded-xl border border-white/50 bg-white/10 backdrop-blur-xl shadow-[0_0_22px_rgba(0,0,0,0.25)]">
      <div className="rounded-xl border border-white/15 px-6 py-4">
        <div className="grid grid-cols-[1.2fr_0.6fr_0.8fr_1fr] items-center gap-4">
          <div className="text-[18px] text-white/90">{label}</div>
          <div className="text-[18px] text-white/85 text-center">{pct}</div>
          <div className={`text-[18px] text-center ${midClass}`}>
            {mid ?? ""}
          </div>
          <div className="text-[18px] text-white/90 text-right">{right}</div>
        </div>
      </div>
    </div>
  );
}

function StackedBar({
  month,
  maxTotal,
}: {
  month: { label: string; stacks: number[] };
  maxTotal: number;
}) {
  const total = month.stacks.reduce((a, b) => a + b, 0);
  const scale = maxTotal > 0 ? total / maxTotal : 0;

  // altezza max simile allo screenshot
  const H = 240; // px
  const barH = Math.max(8, Math.round(H * scale));

  // proporzioni dei segmenti
  const segs = month.stacks.map((v) => (total > 0 ? v / total : 0));

  const colors = [
    "bg-cyan-200",
    "bg-slate-300",
    "bg-fuchsia-700",
    "bg-pink-400",
    "bg-yellow-300",
    "bg-emerald-400",
    "bg-rose-400",
    "bg-violet-700",
  ];

  return (
    <div className="flex w-[52px] flex-col items-center">
      <div
        className="w-full overflow-hidden rounded-sm border border-white/10"
        style={{ height: barH }}
      >
        <div className="flex h-full w-full flex-col">
          {/* stack dall'alto verso il basso */}
          {segs.map((p, i) => (
            <div
              key={i}
              className={colors[i]}
              style={{ height: `${Math.max(2, p * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
