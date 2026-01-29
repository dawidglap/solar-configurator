"use client";

import { useMemo } from "react";

const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Props = {
  kWp: number; // es. 18.0
  yearlyYieldKwhPerKwp?: number; // es. 950 (MVP)
  customerYearlyConsumptionKwh?: number; // es. 17500 (MVP)
  selfConsumptionPct?: number; // es. 0.409 (MVP)
};

export default function ProductionSummaryCard({
  kWp,
  yearlyYieldKwhPerKwp = 950,
  customerYearlyConsumptionKwh = 17500,
  selfConsumptionPct = 0.409,
}: Props) {
  const calc = useMemo(() => {
    if (!kWp || kWp <= 0) return null;

    const production = kWp * yearlyYieldKwhPerKwp; // kWh/a
    const selfUse = customerYearlyConsumptionKwh * selfConsumptionPct; // kWh/a
    const feedIn = Math.max(0, production - selfUse);
    const selfUseShare = production > 0 ? selfUse / production : 0;

    // Autarkiegrad = selfUse / consumption
    const autarky = customerYearlyConsumptionKwh
      ? selfUse / customerYearlyConsumptionKwh
      : 0;

    return {
      production,
      selfUse,
      feedIn,
      selfUseShare,
      autarky,
    };
  }, [
    kWp,
    yearlyYieldKwhPerKwp,
    customerYearlyConsumptionKwh,
    selfConsumptionPct,
  ]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/95 text-black shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
      <div className="px-4 py-3 border-b border-black/10">
        <div className="text-[13px] font-semibold tracking-tight">
          PV-Anlage (Zusammenfassung)
        </div>
        <div className="text-[11px] text-black/55">
          MVP-Berechnung (vereinfachtes Modell)
        </div>
      </div>

      <div className="p-4">
        <TableRow
          label="PV-Generatorleistung"
          value={kWp > 0 ? `${fmt2.format(kWp)} kWp` : "—"}
        />

        <TableRow
          label="Spez. Jahresertrag"
          value={kWp > 0 ? `${fmt2.format(yearlyYieldKwhPerKwp)} kWh/kWp` : "—"}
        />

        <Divider />

        <TableRow
          label="PV-Generatorenergie (Jahresproduktion)"
          value={calc ? `${fmt0.format(calc.production)} kWh/Jahr` : "—"}
        />

        <TableRow
          label="Direkter Eigenverbrauch"
          value={calc ? `${fmt0.format(calc.selfUse)} kWh/Jahr` : "—"}
        />

        <TableRow
          label="Netzeinspeisung"
          value={calc ? `${fmt0.format(calc.feedIn)} kWh/Jahr` : "—"}
        />

        <Divider />

        <TableRow
          label="Eigenverbrauchsanteil"
          value={calc ? `${fmt1.format(calc.selfUseShare * 100)} %` : "—"}
        />

        <TableRow
          label="Autarkiegrad"
          value={calc ? `${fmt1.format(calc.autarky * 100)} %` : "—"}
        />

        <div className="mt-3 text-[10px] text-black/45 leading-snug">
          Hinweis: Werte werden später durch Standort, Dachneigung, Ausrichtung,
          Verschattung und Tarifdaten ersetzt.
        </div>
      </div>
    </div>
  );
}

function TableRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="text-[12px] text-black/80">{label}</div>
      <div className="text-[12px] font-semibold tabular-nums text-black">
        {value}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px w-full bg-black/10" />;
}
