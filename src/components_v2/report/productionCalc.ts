// src/components_v2/report/productionCalc.ts
export function calcProductionSummary(args: {
  kWp: number;
  yearlyYieldKwhPerKwp?: number;
  customerYearlyConsumptionKwh?: number;
  selfConsumptionPct?: number; // 0..1
}) {
  const kWp = Number(args.kWp) || 0;
  const yearlyYieldKwhPerKwp = Number(args.yearlyYieldKwhPerKwp ?? 950) || 0;
  const consumption = Number(args.customerYearlyConsumptionKwh ?? 17500) || 0;
  const selfConsumptionPct = Number(args.selfConsumptionPct ?? 0.409) || 0;

  const production = Math.max(0, kWp * yearlyYieldKwhPerKwp); // kWh/a

  // ✅ clamp: non puoi autoconsumare più di quanto produci
  const potentialSelfUse = Math.max(0, consumption * selfConsumptionPct);
  const selfUse = Math.min(production, potentialSelfUse);

  const feedIn = Math.max(0, production - selfUse);

  const selfUseShare = production > 0 ? selfUse / production : 0; // Eigenverbrauchsanteil (0..1)
  const autarky = consumption > 0 ? selfUse / consumption : 0;     // Autarkiegrad (0..1)

  return {
    production,
    selfUse,
    feedIn,
    selfUseShare,
    autarky,
    selfUseSharePct: selfUseShare * 100,
    autarkyPct: autarky * 100,
  };
}
