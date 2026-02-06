"use client";

import { useMemo } from "react";

const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });

type Props = {
  // ✅ supportiamo entrambi i nomi (vecchio + nuovo)
  selfUseSharePct?: number; // 0..100 (vecchio)
  selfUsePct?: number; // 0..100 (nuovo)
  autarkyPct?: number; // 0..100
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function asPct(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? clamp(n, 0, 100) : 0;
}

export default function EnergieflussPanel(props: Props) {
  const selfUse = asPct(props.selfUsePct ?? props.selfUseSharePct);
  const autarky = asPct(props.autarkyPct);

  const chart = useMemo(() => {
    const labels = [
      "Jan",
      "Feb",
      "Mrz",
      "Apr",
      "Mai",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Okt",
      "Nov",
      "Dez",
    ];

    // produzione stagionale normalizzata (0–100)
    const prod = [20, 28, 45, 65, 85, 95, 100, 92, 70, 48, 30, 22];

    const selfFactor = 0.45 + (selfUse / 100) * 0.35; // 0.45–0.80
    const feedInFactor = 0.6 - (selfUse / 100) * 0.3; // 0.60–0.30

    const eigen = prod.map((p) =>
      clamp(p * selfFactor + autarky * 0.05, 0, 100),
    );
    const feedIn = prod.map((p) =>
      clamp(p * feedInFactor + (100 - autarky) * 0.04, 0, 100),
    );

    return { labels, eigen, feedIn };
  }, [selfUse, autarky]);

  return (
    <div className="space-y-4">
      {/* KPI ROW */}
      <div className="grid grid-cols-2 gap-4">
        <Kpi label="Eigenverbrauch" value={`${fmt1.format(selfUse)} %`} />
        <Kpi label="Autarkiegrad" value={`${fmt1.format(autarky)} %`} />
      </div>

      {/* GRAPH */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <AreaChart labels={chart.labels} s1={chart.eigen} s2={chart.feedIn} />

        <div className="mt-3 flex gap-4 text-[11px] text-white/55">
          <Legend color="bg-emerald-400" label="Eigenverbrauch" />
          <Legend color="bg-sky-400" label="Netzeinspeisung" />
        </div>
      </div>

      <div className="text-[10px] text-white/40 leading-snug">
        Visualisierung dient als Platzhalter. Reale Werte werden später aus
        Standort-, Dach- und Verbrauchsdaten berechnet.
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[11px] text-white/55">{label}</div>
      <div className="mt-1 text-[20px] font-semibold text-[#91DFC6] tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}

function AreaChart({
  labels,
  s1,
  s2,
}: {
  labels: string[];
  s1: number[];
  s2: number[];
}) {
  const W = 520;
  const H = 180;
  const P = 24;
  const max = 100;

  const x = (i: number) => P + (i / (labels.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);

  const path = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");

  const area = (data: number[]) =>
    `${path(data)} L ${x(data.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]">
      <path d={area(s2)} fill="rgba(56,189,248,0.25)" />
      <path d={path(s2)} fill="none" stroke="rgb(56,189,248)" strokeWidth="2" />

      <path d={area(s1)} fill="rgba(52,211,153,0.35)" />
      <path d={path(s1)} fill="none" stroke="rgb(52,211,153)" strokeWidth="2" />
    </svg>
  );
}
