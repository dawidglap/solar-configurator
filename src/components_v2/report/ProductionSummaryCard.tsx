"use client";

import { useMemo } from "react";
import { calcProductionSummary } from "./productionCalc";

const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Props = {
  kWp: number;
  yearlyYieldKwhPerKwp?: number;
  customerYearlyConsumptionKwh?: number;
  selfConsumptionPct?: number;
};

export default function ProductionSummaryCard({
  kWp,
  yearlyYieldKwhPerKwp = 950,
  customerYearlyConsumptionKwh = 17500,
  selfConsumptionPct = 0.409,
}: Props) {
  const calc = useMemo(
    () =>
      calcProductionSummary({
        kWp,
        yearlyYieldKwhPerKwp,
        customerYearlyConsumptionKwh,
        selfConsumptionPct,
      }),
    [
      kWp,
      yearlyYieldKwhPerKwp,
      customerYearlyConsumptionKwh,
      selfConsumptionPct,
    ],
  );

  return (
    <div className="h-full min-h-0 rounded-xl border border-white/10 bg-white/15 text-white shadow-[0_18px_60px_rgba(0,0,0,0.35)] flex flex-col">
      {/* HEADER (più compatto) */}
      <div className="px-3 py-2 border-b border-black/10 shrink-0">
        <div className="text-[12px] font-semibold tracking-tight">
          PV-Anlage (Zusammenfassung)
        </div>
        <div className="text-[10px] text-white/55">
          MVP-Berechnung (vereinfachtes Modell)
        </div>
      </div>

      {/* BODY (più compatto, ma SENZA scroll: entra perché tutto è più piccolo) */}
      <div className="p-3 flex-1 min-h-0">
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

        {/* Nota più corta e piccola */}
        <div className="mt-2 text-[9px] text-black/45 leading-snug">
          Hinweis: Später ersetzen wir Werte durch Standort-/Dachdaten (Neigung,
          Ausrichtung, Verschattung) und Tarife.
        </div>
      </div>
    </div>
  );
}

function TableRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="text-[11px] text-white/80 leading-tight">{label}</div>
      <div className="text-[11px] font-semibold tabular-nums text-white whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 h-px w-full bg-white/10" />;
}
