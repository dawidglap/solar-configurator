// src/components_v2/state/slices/istSlice.ts
import type { StateCreator } from "zustand";

export type BuildingType = "ein" | "mehr" | "industrie" | "";
export type RoofShape = "satteldach" | "flachdach" | "pultdach" | "";
export type RoofCover =
  | "tonziegel"
  | "flachziegel"
  | "flach_begruent"
  | "flach_bekiest"
  | "flacheternit"
  | "bitumen"
  | "trapezblech"
  | "betonziegel"
  | "";

export type HeatingType = "oel" | "gas" | "wp" | "fernwaerme" | "andere" | "";
export type MontageTime = "4" | "6" | "12" | "";

export type IstChecklist = {
  inverterPhoto: boolean;
  meterPhoto: boolean;
  cabinetPhoto: boolean;
  lightning: boolean;
  internet: boolean;
  naProtection: boolean;
  evg: boolean;
  zev: boolean;
};

export type IstData = {
  // ✅ esattamente i campi che usa IstSituationStep
  checklist: IstChecklist;
  unitsCount: string;

  buildingType: BuildingType;
  roofShape: RoofShape;
  roofCover: RoofCover;

  consumption: string;
  heating: HeatingType;
  heatingCombo: boolean;

  hakSize: string;

  evTopic: "yes" | "no" | "";
  evCar: string;

  montageTime: MontageTime;

  dismantling: string;
  dismantlingNote: string;

  // flags / meta
  completed: boolean;
};

export const defaultIst: IstData = {
  checklist: {
    inverterPhoto: false,
    meterPhoto: false,
    cabinetPhoto: false,
    lightning: false,
    internet: false,
    naProtection: false,
    evg: false,
    zev: false,
  },

  unitsCount: "",

  buildingType: "",
  roofShape: "",
  roofCover: "",

  consumption: "",
  heating: "",
  heatingCombo: false,

  hakSize: "",

  evTopic: "",
  evCar: "",

  montageTime: "",

  dismantling: "",
  dismantlingNote: "",

  completed: false,
};

export type IstSlice = {
  ist: IstData;
  setIst: (patch: Partial<IstData>) => void;
  setIstAll: (value: IstData) => void;
  resetIst: () => void;
};

export const createIstSlice: StateCreator<IstSlice, [], [], IstSlice> = (set) => ({
  ist: defaultIst,

  setIst: (patch) =>
    set((state) => ({
      ist: { ...state.ist, ...patch },
    })),

  setIstAll: (value) => set(() => ({ ist: value })),

  resetIst: () => set(() => ({ ist: defaultIst })),
});
