export const CHECKLIST_ITEMS = [
  { key: "projekt_geprueft", label: "Projekt geprüft", order: 1 },
  { key: "baumeldung_eingereicht", label: "Baumeldung eingereicht", order: 2 },
  { key: "baumeldung_genehmigt", label: "Baumeldung genehmigt", order: 3 },
  {
    key: "netzanschlussgesuch_eingereicht",
    label: "Netzanschlussgesuch eingereicht",
    order: 4,
  },
  {
    key: "netzanschlussgesuch_genehmigt",
    label: "Netzanschlussgesuch genehmigt",
    order: 5,
  },
  { key: "material_bestellt", label: "Material bestellt", order: 6 },
  { key: "material_geliefert", label: "Material geliefert", order: 7 },
  { key: "montage_geplant", label: "Montage geplant", order: 8 },
  { key: "montage_durchgefuehrt", label: "Montage durchgeführt", order: 9 },
  {
    key: "elektroinstallation_durchgefuehrt",
    label: "Elektroinstallation durchgeführt",
    order: 10,
  },
  { key: "inbetriebnahme", label: "Inbetriebnahme", order: 11 },
  { key: "abnahme_kunde", label: "Abnahme Kunde", order: 12 },
  { key: "abnahme_ewz", label: "Abnahme EWZ", order: 13 },
  {
    key: "schlussrechnung_versendet",
    label: "Schlussrechnung versendet",
    order: 14,
  },
  { key: "projekt_abgeschlossen", label: "Projekt abgeschlossen", order: 15 },
] as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number]["key"];

export const CHECKLIST_ITEM_MAP = new Map(
  CHECKLIST_ITEMS.map((item) => [item.key, item]),
);
