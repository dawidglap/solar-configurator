// src/constants/heatpumps.ts

export type HeatPumpSpec = {
  id: string;
  label: string;
  yearlyConsumptionKwh: number;
  cop: number;
  priceChf: number; // ← NEW
  note?: string;
};

export const HEATPUMPS: HeatPumpSpec[] = [
  {
    id: "none",
    label: "Keine Wärmepumpe",
    yearlyConsumptionKwh: 0,
    cop: 0,
    priceChf: 0,
  },
  {
    id: "hp_small",
    label: "Wärmepumpe EFH klein",
    yearlyConsumptionKwh: 3500,
    cop: 4.0,
    priceChf: 18000,
    note: "Luft-Wasser WP",
  },
  {
    id: "hp_medium",
    label: "Wärmepumpe EFH",
    yearlyConsumptionKwh: 5000,
    cop: 4.2,
    priceChf: 24000,
    note: "Luft-Wasser WP",
  },
  {
    id: "hp_large",
    label: "Wärmepumpe EFH + Warmwasser",
    yearlyConsumptionKwh: 7000,
    cop: 4.5,
    priceChf: 30000,
    note: "WP + Boiler",
  },
];
