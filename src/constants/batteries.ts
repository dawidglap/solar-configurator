// src/constants/batteries.ts

export type BatterySpec = {
  id: string;
  label: string;
  capacityKwh: number;
  usablePct: number;
  efficiencyPct: number;
  priceChf: number; // ← NEW
  note?: string;
};

export const BATTERIES: BatterySpec[] = [
  {
    id: "none",
    label: "Keine Batterie",
    capacityKwh: 0,
    usablePct: 0,
    efficiencyPct: 0,
    priceChf: 0,
  },
  {
    id: "battery_small",
    label: "Batterie 5 kWh",
    capacityKwh: 5,
    usablePct: 0.9,
    efficiencyPct: 0.92,
    priceChf: 4500,
    note: "typisch EFH klein",
  },
  {
    id: "battery_medium",
    label: "Batterie 10 kWh",
    capacityKwh: 10,
    usablePct: 0.9,
    efficiencyPct: 0.93,
    priceChf: 8500,
    note: "typisch EFH",
  },
  {
    id: "battery_large",
    label: "Batterie 15 kWh",
    capacityKwh: 15,
    usablePct: 0.9,
    efficiencyPct: 0.94,
    priceChf: 12000,
    note: "EFH + E-Auto",
  },
];
