// src/constants/chargers.ts

export type ChargerSpec = {
  id: string;
  label: string;
  yearlyConsumptionKwh: number;
  priceChf: number; // ← NEW
  note?: string;
};

export const CHARGERS: ChargerSpec[] = [
  {
    id: "none",
    label: "Keine Ladestation",
    yearlyConsumptionKwh: 0,
    priceChf: 0,
  },
  {
    id: "ev_small",
    label: "E-Auto (10'000 km/Jahr)",
    yearlyConsumptionKwh: 1800,
    priceChf: 1800,
    note: "Wallbox Basic",
  },
  {
    id: "ev_medium",
    label: "E-Auto (15'000 km/Jahr)",
    yearlyConsumptionKwh: 2700,
    priceChf: 2500,
    note: "Wallbox Smart",
  },
  {
    id: "ev_large",
    label: "E-Auto (25'000 km/Jahr)",
    yearlyConsumptionKwh: 4500,
    priceChf: 3500,
    note: "Wallbox Smart + Lastmanagement",
  },
];
