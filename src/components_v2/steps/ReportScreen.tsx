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
import EnergieflussPanel from "../report/EnergieFlussPanel";
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
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom-right"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" />
      </div>

      <div className="relative z-10 w-full h-full grid grid-cols-12 gap-0 pt-10">
        <aside className="col-span-3 border-r border-white/10 bg-neutral-900/35 backdrop-blur-xl overflow-y-auto">
          <div className="p-4 min-h-full">
            <div className="text-white/90 text-lg font-semibold">Bericht</div>
            <div className="mt-1 text-[12px] text-white/55">
              MVP: Links Eingaben, rechts Platzhalter bis Kundendaten vorliegen.
            </div>

            <SectionTitle title="Energiefluss" />
            <div className="mt-3 space-y-3">
              <SelectField
                label="Batterie"
                value={batteryId}
                onChange={setBatteryId}
                options={BATTERIES}
              />
              <SelectField
                label="Ladestation"
                value={chargerId}
                onChange={setChargerId}
                options={CHARGERS}
              />
              <SelectField
                label="Wärmepumpe"
                value={heatpumpId}
                onChange={setHeatpumpId}
                options={HEATPUMPS}
              />
            </div>

            <SectionTitle title="Wirtschaftlichkeit" />
            <div className="mt-3 space-y-3">
              <InputLike
                label="Rabatt in Zahlen"
                value={rabattChf}
                onChange={setRabattChf}
                suffix="CHF"
                placeholder="z.B. 500"
              />
              <InputLike
                label="Rabatt in %"
                value={rabattPct}
                onChange={setRabattPct}
                suffix="%"
                placeholder="z.B. 5"
              />

              <div className="pt-2" />

              <InputLike
                label="Förderungen"
                value={foerderungen}
                onChange={setFoerderungen}
                suffix="CHF"
                placeholder="z.B. 2515.80"
              />

              <Dropdown
                label="Zahlungsbedingungen"
                value={paymentPlan}
                onChange={setPaymentPlan}
                options={PAYMENT_PLANS}
              />

              <InputLike
                label="Skonto"
                value={""}
                onChange={() => {}}
                suffix="%"
                placeholder="(später)"
                disabled
              />
            </div>

            <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[12px] text-white/70 font-medium">
                Geplante PV-Anlage
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-white/70">
                <div className="text-white/50">Module</div>
                <div className="text-right tabular-nums">
                  {moduleInfo.qty > 0 ? fmt0.format(moduleInfo.qty) : "—"}
                </div>

                <div className="text-white/50">Leistung</div>
                <div className="text-right tabular-nums">{leftKwpLabel}</div>

                <div className="text-white/50">Modell</div>
                <div className="text-right">
                  {moduleInfo.spec
                    ? `${moduleInfo.spec.brand} ${moduleInfo.spec.model}`
                    : "—"}
                </div>
              </div>
            </div>

            <div className="mt-4 text-[11px] text-white/45">
              Hinweis: “Wirtschaftlichkeit” später nur anzeigen, wenn
              Amortisation &lt; 12 Jahre.
            </div>

            <div className="mt-3">
              <InputLike
                label="Amortisation (Jahre)"
                value={amortYears}
                onChange={setAmortYears}
                placeholder="z.B. 11"
              />
            </div>
          </div>
        </aside>

        <main className="col-span-9 bg-neutral-900/25 backdrop-blur-xl overflow-y-auto">
          <div className="p-6 min-h-full">
            <div className="grid grid-cols-12 gap-6">
              <CardShell
                title="Energiefluss"
                className="col-span-12 lg:col-span-6"
              >
                <EnergieflussPanel
                  selfUseSharePct={selfUseSharePct}
                  autarkyPct={autarkyPct}
                />
              </CardShell>

              <CardShell
                title="Wirtschaftlichkeit"
                className="col-span-12 lg:col-span-6"
              >
                <WirtschaftlichkeitPanel
                  productionKwhYear={prodCalc?.production ?? 0}
                  selfUseKwhYear={prodCalc?.selfUse ?? 0}
                  feedInKwhYear={prodCalc?.feedIn ?? 0}
                  amortYearsInput={Number(amortYears) || undefined}
                />
              </CardShell>

              <CardShell
                title="Produktion"
                className="col-span-12 lg:col-span-6"
              >
                <ProductionSummaryCard kWp={moduleInfo.kWp} />
              </CardShell>

              <CardShell
                title="Ersparnis"
                className="col-span-12 lg:col-span-6"
              >
                <div className="grid grid-cols-12 gap-3">
                  <MiniKpiGhost className="col-span-12 md:col-span-4" />
                  <MiniKpiGhost className="col-span-12 md:col-span-4" />
                  <MiniKpiGhost className="col-span-12 md:col-span-4" />
                </div>
                <div className="mt-4">
                  <SkeletonChart height={180} />
                </div>
              </CardShell>
            </div>

            <div className="mt-6 text-[11px] text-white/45">
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
    <div className="mt-8">
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
      <div className="text-white/70 text-sm">{label}</div>
      <div className="mt-2 relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-full border border-white/15 bg-white/5 px-4 py-2 pr-10 text-[13px] text-white/80 outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
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
      <div className="text-white/70 text-sm">{label}</div>
      <div className="mt-2 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent text-[13px] text-white/80 outline-none placeholder:text-white/30 disabled:opacity-60"
        />
        {suffix && (
          <span className="text-[12px] text-white/45 whitespace-nowrap">
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
      <div className="text-white/70 text-sm">{label}</div>
      <div className="mt-2 relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full appearance-none rounded-full border border-white/15 bg-white/5 px-4 py-2 pr-10 text-[13px] text-white/80 outline-none"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
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
        "rounded-2xl border border-white/10 bg-neutral-900/35 backdrop-blur-xl",
        "shadow-[0_0_35px_rgba(0,0,0,0.35)]",
        className ?? "",
      ].join(" ")}
    >
      <div className="px-5 py-4">
        <div className="text-white/85 text-sm font-medium text-center">
          {title}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

function MiniKpiGhost({ className }: { className?: string }) {
  return (
    <div
      className={[
        "rounded-xl border border-white/15 bg-white/5 p-3",
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
