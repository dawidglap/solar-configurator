"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { PANEL_CATALOG } from "@/constants/panels";
import ProductionSummaryCard from "../report/ProductionSummaryCard";
import { BATTERIES } from "@/constants/batteries";
import { CHARGERS } from "@/constants/chargers";
import { HEATPUMPS } from "@/constants/heatpumps";
import EnergieflussPanel from "../report/EnergieflussPanel";

import { calcProductionSummary } from "../report/productionCalc";
import WirtschaftlichkeitPanel from "../report/WirtschaftlichkeitPanel";

const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

type PaymentPlanKey = "50-40-10" | "100" | "30-60-10";

const PAYMENT_PLANS: { key: PaymentPlanKey; label: string }[] = [
  { key: "50-40-10", label: "50% / 40% / 10%" },
  { key: "100", label: "100%" },
  { key: "30-60-10", label: "30% / 60% / 10%" },
];

function calcKwpFromPanels(panels: any[]) {
  const qty = panels.length;
  const panelId = panels[0]?.panelId;
  const spec = panelId
    ? PANEL_CATALOG.find((p) => p.id === panelId)
    : undefined;
  const wp = spec?.wp ?? 0;
  const kWp = (qty * wp) / 1000;
  return { qty, panelId, spec, wp, kWp };
}

// ✅ pill sizing = come Stuckliste (h-7, rounded-full, text-[11px], px-2)
const pillBase =
  "w-full h-7 rounded-full border border-white/80 bg-transparent px-2 text-white text-[11px] leading-none outline-none " +
  "focus:ring-1 focus:ring-white focus:border-white transition";

export default function ReportScreen() {
  const placedPanels = usePlannerV2Store((s) => s.panels);

  const moduleInfo = useMemo(
    () => calcKwpFromPanels(placedPanels),
    [placedPanels],
  );

  // ✅ produzione unificata, no NaN
  const prodCalc = useMemo(() => {
    if (!moduleInfo.kWp || moduleInfo.kWp <= 0) return null;

    return calcProductionSummary({
      kWp: moduleInfo.kWp,
      yearlyYieldKwhPerKwp: 950, // placeholder
      customerYearlyConsumptionKwh: 17500, // placeholder
      selfConsumptionPct: 0.409, // placeholder
    });
  }, [moduleInfo.kWp]);

  const selfUseSharePct = prodCalc?.selfUseSharePct ?? 0;
  const autarkyPct = prodCalc?.autarkyPct ?? 0;

  // stato UI
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlanKey>("50-40-10");
  const [rabattChf, setRabattChf] = useState<string>("");
  const [rabattPct, setRabattPct] = useState<string>("");
  const [foerderungen, setFoerderungen] = useState<string>("");
  const [amortYears, setAmortYears] = useState<string>("11");
  const [batteryId, setBatteryId] = useState<string>("none");
  const [chargerId, setChargerId] = useState<string>("none");
  const [heatpumpId, setHeatpumpId] = useState<string>("none");

  const leftKwpLabel =
    moduleInfo.spec && moduleInfo.qty > 0
      ? `${fmt2.format(moduleInfo.kWp)} kWp`
      : "—";

  return (
    <div className="relative w-full h-full overflow-hidden border-[#7E8B97] border-l rounded-b-2xl">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom-right"
        />
      </div>

      {/* ✅ stessa struttura/dimensioni di Stuckliste: grid 12, left 2/12 con pt-10 + px-2 */}
      <div className="relative z-10 w-full h-full grid grid-cols-12 gap-0 pt-0">
        <aside className="col-span-2 border-r px-2 border-white/10 bg-transparent backdrop-blur-md overflow-y-auto">
          <div className="p-2 min-h-full">
            {/* === Energiefluss === */}
            <div className="text-white/90 text-[14px] font-semibold">
              Energiefluss
            </div>

            <div className="mt-3 space-y-3">
              {/* Batterie */}
              <SelectField
                label="Batterie"
                value={batteryId}
                onChange={setBatteryId}
                options={BATTERIES}
              />

              {/* Ladestation */}
              <SelectField
                label="Ladestation"
                value={chargerId}
                onChange={setChargerId}
                options={CHARGERS}
              />

              {/* Wärmepumpe */}
              <SelectField
                label="Wärmepumpe"
                value={heatpumpId}
                onChange={setHeatpumpId}
                options={HEATPUMPS}
              />
            </div>

            {/* === Wirtschaftlichkeit === */}
            <div className="mt-4 text-white/90 text-[14px] font-semibold">
              Wirtschaftlichkeit
            </div>

            <div className="mt-3 space-y-3">
              <InputLike
                label="Rabatt in Zahlen"
                value={rabattChf}
                onChange={setRabattChf}
                placeholder="Rabatt in Zahlen"
              />

              <InputLike
                label="Rabatt in %"
                value={rabattPct}
                onChange={setRabattPct}
                placeholder="Rabatt in %"
              />
            </div>

            {/* === Förderungen === */}
            <div className="mt-4 text-white/90 text-[14px] font-semibold">
              Förderungen
            </div>

            <div className="mt-3 space-y-3">
              <InputLike
                label="Förderungen"
                value={foerderungen}
                onChange={setFoerderungen}
                placeholder="2'515.80"
              />
            </div>

            {/* === Zahlungsbedingungen === */}
            <div className="mt-4 text-white/90 text-[14px] font-semibold">
              Zahlungsbedingungen:
            </div>

            <div className="mt-3 space-y-3">
              <Dropdown
                label="Zahlungsbedingungen"
                value={paymentPlan}
                onChange={setPaymentPlan}
                options={PAYMENT_PLANS}
              />
            </div>

            {/* === Skonto === */}
            <div className="mt-4 text-white/90 text-[14px] font-semibold">
              Skonto:
            </div>

            <div className="mt-3 space-y-3">
              <InputLike
                label="Skonto"
                value={""}
                onChange={() => {}}
                placeholder="%"
                disabled
              />
            </div>
          </div>
        </aside>

        {/* ✅ solo struttura: main ora 10/12 (contenuto invariato) */}
        <main className="col-span-10 bg-transparent backdrop-blur-md overflow-hidden">
          {/* ✅ niente scroll: il contenuto si adatta all’altezza disponibile */}
          <div className="p-6 h-full min-h-0 flex flex-col">
            {/* ✅ griglia 2x2 su desktop/laptop, 1 colonna su schermi piccoli */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-6 auto-rows-fr">
              <CardShell title="Energiefluss" className="min-h-0">
                {/* ✅ evita overflow interni */}
                <div className="h-full min-h-0 overflow-hidden">
                  <EnergieflussPanel
                    selfUseSharePct={selfUseSharePct}
                    autarkyPct={autarkyPct}
                  />
                </div>
              </CardShell>

              <CardShell title="Wirtschaftlichkeit" className="min-h-0">
                <div className="h-full min-h-0 overflow-hidden">
                  <WirtschaftlichkeitPanel
                    productionKwhYear={prodCalc?.production ?? 0}
                    selfUseKwhYear={prodCalc?.selfUse ?? 0}
                    feedInKwhYear={prodCalc?.feedIn ?? 0}
                    amortYearsInput={Number(amortYears) || undefined}
                  />
                </div>
              </CardShell>

              <CardShell title="Produktion" className="min-h-0">
                <div className="h-full min-h-0 overflow-hidden">
                  <ProductionSummaryCard kWp={moduleInfo.kWp} />
                </div>
              </CardShell>

              <CardShell title="Ersparnis" className="min-h-0">
                {/* ✅ layout interno che “respira” ma non forza scroll */}
                <div className="h-full min-h-0 flex flex-col">
                  <div className="grid grid-cols-12 gap-3">
                    <MiniKpiGhost className="col-span-12 md:col-span-4" />
                    <MiniKpiGhost className="col-span-12 md:col-span-4" />
                    <MiniKpiGhost className="col-span-12 md:col-span-4" />
                  </div>

                  <div className="mt-4 flex-1 min-h-0">
                    {/* ✅ chart si adatta allo spazio rimasto */}
                    <SkeletonChart height={180} />
                  </div>
                </div>
              </CardShell>
            </div>

            {/* ✅ footer info sempre visibile, non spinge a scrollare */}
            <div className="mt-4 text-[11px] text-white/45">
              Diagramme = Platzhalter. Sobald der Kunde Werte liefert, ersetzen
              wir Skeletons durch echte Charts.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------- UI atoms ---------------- */

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mt-4">
      <div className="text-white/90 text-base font-semibold">{title}</div>
      <div className="mt-2 h-px w-full bg-white/10" />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div>
      <div className="text-white/70 text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={pillBase + " appearance-none pr-8 text-white/80"}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
      </div>
    </div>
  );
}

function InputLike({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-white/70 text-[10px] uppercase tracking-wide">
        {label}
      </div>

      <div className={pillBase + " flex items-center gap-2"}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent text-[11px] text-white/80 outline-none placeholder:text-white/30 disabled:opacity-60"
        />
        {suffix && (
          <span className="text-[10px] text-white/45 whitespace-nowrap">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Dropdown<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div>
      <div className="text-white/70 text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={pillBase + " appearance-none pr-8 text-white/80"}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
      </div>
    </div>
  );
}
function CardShell({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        // ✅ importantissimo: h-full/min-h-0/overflow-hidden per non far sbordare i panel
        "h-full min-h-0 overflow-hidden",
        "rounded-2xl border border-white/10 bg-neutral-500/55 backdrop-blur-xl",
        "shadow-[0_0_35px_rgba(0,0,0,0.35)]",
        className ?? "",
      ].join(" ")}
    >
      {/* ✅ flex-col per dare uno spazio “misurabile” ai children */}
      <div className="h-full min-h-0 flex flex-col px-5 py-4">
        <div className="text-white/85 text-sm font-medium text-center shrink-0">
          {title}
        </div>

        {/* ✅ children prendono lo spazio restante */}
        <div className="mt-4 flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

function MiniKpiGhost({ className }: { className?: string }) {
  return (
    <div
      className={[
        "rounded-xl border border-white bg-white/5 p-3",
        className ?? "",
      ].join(" ")}
    >
      <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
      <div className="mt-2 h-6 w-24 rounded bg-white/10 animate-pulse" />
    </div>
  );
}

function SkeletonChart({ height }: { height: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div
        className="w-full rounded-lg bg-white/10 animate-pulse"
        style={{ height }}
      />
      <div className="mt-3 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
      <div className="mt-2 h-3 w-1/2 rounded bg-white/10 animate-pulse" />
    </div>
  );
}
