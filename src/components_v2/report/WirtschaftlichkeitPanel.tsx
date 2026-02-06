"use client";

import { useMemo } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { PANEL_CATALOG } from "@/constants/panels";

const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function safeNumber(n: any, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

type Props = {
  productionKwhYear: number;
  selfUseKwhYear: number;
  feedInKwhYear: number;
  amortYearsInput?: number;
  tariffChfPerKwh?: number;
  feedInChfPerKwh?: number;
  years?: number;
};

export default function WirtschaftlichkeitPanel({
  productionKwhYear,
  selfUseKwhYear,
  feedInKwhYear,
  tariffChfPerKwh = 0.277,
  feedInChfPerKwh = 0.1,
  years = 15,
}: Props) {
  const placedPanels = usePlannerV2Store((s) => s.panels);
  const selectedPanelId = usePlannerV2Store((s) => s.selectedPanelId);
  const getPartsTotals = usePlannerV2Store((s) => s.getPartsTotals);

  const calc = useMemo(() => {
    const startYear = new Date().getFullYear();

    // ---- investimento da store (moduli + extras)
    const qty = placedPanels?.length ?? 0;
    const panelId = placedPanels?.[0]?.panelId || selectedPanelId || "";
    const spec =
      (panelId && PANEL_CATALOG.find((p) => p.id === panelId)) || undefined;

    const priceChf = safeNumber((spec as any)?.priceChf, 0);
    const modulesTotal = qty * priceChf;
    const extrasTotal = safeNumber(getPartsTotals?.()?.extrasTotal, 0);
    const investment = modulesTotal + extrasTotal;

    // ---- shares da prodCalc (year1)
    const prod0 = Math.max(0, safeNumber(productionKwhYear, 0));
    const self0 = clamp(safeNumber(selfUseKwhYear, 0), 0, prod0);
    const feed0 = clamp(safeNumber(feedInKwhYear, 0), 0, prod0);

    const selfShare = prod0 > 0 ? self0 / prod0 : 0;
    const feedShare = prod0 > 0 ? feed0 / prod0 : 0;

    const opexRate = 0.01; // 1%/a
    const degrRate = 0.005; // 0.5%/a

    // se non ho investimento → serie vuota (ma qui almeno vedrai 0 sensato)
    const series: Array<{ yearLabel: string; cum: number }> = [];
    let cum = investment > 0 ? -investment : 0;

    for (let i = 0; i < years; i++) {
      const factor = Math.pow(1 - degrRate, i);
      const prod = prod0 * factor;

      const selfUse = prod * selfShare;
      const feedIn = prod * feedShare;

      const gross = selfUse * tariffChfPerKwh + feedIn * feedInChfPerKwh;
      const opex = investment > 0 ? investment * opexRate : 0;
      const net = gross - opex;

      cum += net;

      series.push({
        yearLabel: String(startYear + i),
        cum,
      });
    }

    // breakeven
    let breakevenYears = 0;
    let prevCum = investment > 0 ? -investment : 0;

    for (let i = 0; i < series.length; i++) {
      const cur = series[i].cum;
      if (cur >= 0 && investment > 0) {
        const prevIndex = i; // year i is (i+1)
        const prevVal = prevCum;
        const nextVal = cur;

        if (nextVal === prevVal) breakevenYears = i + 1;
        else {
          const t = clamp((0 - prevVal) / (nextVal - prevVal), 0, 1);
          breakevenYears = prevIndex + t; // 0-based years
        }
        break;
      }
      prevCum = cur;
    }

    // ROI year 1
    const annualGross1 = self0 * tariffChfPerKwh + feed0 * feedInChfPerKwh;
    const annualNet1 =
      annualGross1 - (investment > 0 ? investment * opexRate : 0);
    const roiPct = investment > 0 ? (annualNet1 / investment) * 100 : 0;

    return {
      investment,
      modulesTotal,
      extrasTotal,
      annualNet1,
      roiPct,
      breakevenYears,
      series,
      startYear,
      tariffChfPerKwh,
      feedInChfPerKwh,
    };
  }, [
    placedPanels,
    selectedPanelId,
    getPartsTotals,
    productionKwhYear,
    selfUseKwhYear,
    feedInKwhYear,
    tariffChfPerKwh,
    feedInChfPerKwh,
    years,
  ]);

  const breakevenLabel =
    calc.breakevenYears > 0
      ? `nach ${fmt1.format(calc.breakevenYears)} Jahre`
      : "—";

  return (
    <div className="relative">
      <div className="grid grid-cols-12 gap-3">
        <KpiBox
          className="col-span-12 md:col-span-4"
          title="Breakeven"
          value={breakevenLabel}
          sub="vereinfachtes Modell (MVP)"
        />
        <KpiBox
          className="col-span-12 md:col-span-4"
          title="Gesamtinvestition"
          value={`${fmt0.format(calc.investment)} CHF`}
          sub={`Module ${fmt0.format(calc.modulesTotal)} + Extras ${fmt0.format(calc.extrasTotal)}`}
        />
        <KpiBox
          className="col-span-12 md:col-span-4"
          title="Rendite"
          value={`${fmt1.format(calc.roiPct)} % p.a.`}
          sub={`${fmt0.format(calc.annualNet1)} CHF / Jahr`}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-white/85 font-medium">
            Wirtschaftlichkeit (Cashflow)
          </div>
          <div className="text-[12px] text-white/55">
            Tarif: {fmt2.format(calc.tariffChfPerKwh)} CHF/kWh · Einspeisung:{" "}
            {fmt2.format(calc.feedInChfPerKwh)} CHF/kWh
          </div>
        </div>

        <div className="mt-3">
          <CashflowBarChart series={calc.series} />
        </div>

        <div className="mt-3 text-[12px] text-white/45 leading-snug">
          Hinweis: MVP-Placeholder. Später ersetzen wir
          Tarife/Profil/Degradation/OPEX durch echte Standortdaten
          (EIC/Netzbetreiber), Eigenverbrauchsprofil, Wartung, etc.
        </div>
      </div>
    </div>
  );
}

function KpiBox(props: {
  title: string;
  value: string;
  sub: string;
  className?: string;
}) {
  const { title, value, sub, className } = props;
  return (
    <div
      className={[
        "rounded-2xl border border-white/10 bg-white/5 px-4 py-4",
        className ?? "",
      ].join(" ")}
    >
      <div className="text-[13px] text-white/70">{title}</div>
      {/* ✅ numeri più piccoli rispetto a prima */}
      <div className="mt-2 text-[18px] md:text-[18px] leading-none font-semibold text-[#91DFC6] tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-[13px] text-white/45">{sub}</div>
    </div>
  );
}

function CashflowBarChart(props: {
  series: Array<{ yearLabel: string; cum: number }>;
}) {
  const { series } = props;

  const W = 860;
  const H = 320;

  const padL = 72;
  const padR = 18;
  const padT = 16;
  const padB = 46;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = series.map((s) => s.cum);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);

  const range = Math.max(1, maxV - minV);
  const minY = minV - range * 0.08;
  const maxY = maxV + range * 0.08;

  const y = (v: number) => padT + innerH * (1 - (v - minY) / (maxY - minY));
  const x = (i: number) => padL + (innerW * i) / Math.max(1, series.length - 1);

  const zeroY = y(0);

  const ticks = 6;
  const tickVals = Array.from({ length: ticks }, (_, i) => {
    const t = i / (ticks - 1);
    return minY + (maxY - minY) * (1 - t);
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {tickVals.map((tv, idx) => {
        const yy = y(tv);
        return (
          <g key={idx}>
            <line
              x1={padL}
              y1={yy}
              x2={W - padR}
              y2={yy}
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="1"
            />
            <text
              x={padL - 10}
              y={yy + 4}
              textAnchor="end"
              fontSize="12"
              fill="rgba(255,255,255,0.65)"
            >
              {fmt0.format(tv)}
            </text>
          </g>
        );
      })}

      <line
        x1={padL}
        y1={zeroY}
        x2={W - padR}
        y2={zeroY}
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />

      {series.map((s, i) => {
        const xv = x(i);
        const nextX =
          i < series.length - 1
            ? x(i + 1)
            : xv + innerW / Math.max(1, series.length);
        const step = Math.max(1, nextX - xv);
        const barW = Math.max(10, step * 0.68);

        const v = s.cum;
        const top = y(Math.max(0, v));
        const bottom = y(Math.min(0, v));
        const h = Math.max(2, bottom - top);

        const isPos = v >= 0;

        return (
          <g key={s.yearLabel}>
            <rect
              x={xv - barW / 2}
              y={top}
              width={barW}
              height={h}
              rx={8}
              fill={isPos ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)"}
              opacity={0.95}
            />
            <text
              x={xv}
              y={H - 16}
              textAnchor="middle"
              fontSize="12"
              fill="rgba(255,255,255,0.72)"
            >
              {s.yearLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
