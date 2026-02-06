// src/components_v2/report/productionCalc.ts
export function calcProductionSummary(params: {
  kWp: number;
  yearlyYieldKwhPerKwp?: number; // default 950
  customerYearlyConsumptionKwh?: number; // default 17500
  selfConsumptionPct?: number; // default 0.409 (nota: è un coefficiente, non %)
}) {
  const {
    kWp,
    yearlyYieldKwhPerKwp = 950,
    customerYearlyConsumptionKwh = 17500,
    selfConsumptionPct = 0.409,
  } = params;

  if (!kWp || kWp <= 0) return null;

  const production = kWp * yearlyYieldKwhPerKwp; // kWh/a
  const selfUse = customerYearlyConsumptionKwh * selfConsumptionPct; // kWh/a (come nel tuo MVP)
  const feedIn = Math.max(0, production - selfUse);
  const selfUseShare = production > 0 ? selfUse / production : 0; // Eigenverbrauchsanteil
  const autarky = customerYearlyConsumptionKwh
    ? selfUse / customerYearlyConsumptionKwh
    : 0;

  return { production, selfUse, feedIn, selfUseShare, autarky };
}
