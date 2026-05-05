export const CHECKLIST_ITEMS = [
  { key: "projekt_geprueft", label: "Projekt geprüft", order: 1 },
  { key: "baumeldung_eingereicht", label: "Baumeldung eingereicht", order: 2 },
  { key: "tag_eingereicht", label: "TAG eingereicht", order: 3 },
  {
    key: "installationsanzeige_eingereicht",
    label: "Installationsanzeige eingereicht",
    order: 4,
  },
  {
    key: "pronovo_foerderung_angemeldet",
    label: "Pronovo / Förderung angemeldet",
    order: 5,
  },
  { key: "montage_geplant", label: "Montage geplant", order: 6 },
  { key: "montage_ausgefuehrt", label: "Montage ausgeführt", order: 7 },
  {
    key: "elektroinstallation_geplant",
    label: "Elektroinstallation geplant",
    order: 8,
  },
  {
    key: "elektroinstallation_ausgefuehrt",
    label: "Elektroinstallation ausgeführt",
    order: 9,
  },
  { key: "anlage_in_betrieb", label: "Anlage in Betrieb", order: 10 },
  {
    key: "sina_kontrolle_abgeschlossen",
    label: "SiNa und Kontrolle abgeschlossen",
    order: 11,
  },
  {
    key: "pronovo_foerderung_eingereicht",
    label: "Pronovo / Förderung eingereicht",
    order: 12,
  },
  {
    key: "unterlagen_an_ew_zugestellt",
    label: "Unterlagen an EW zugestellt",
    order: 13,
  },
  {
    key: "technische_dokumentation_gesendet",
    label: "Technische Dokumentation gesendet",
    order: 14,
  },
  { key: "projekt_abgeschlossen", label: "Projekt abgeschlossen", order: 15 },
] as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number]["key"];

export const CHECKLIST_ITEM_MAP = new Map(
  CHECKLIST_ITEMS.map((item) => [item.key, item]),
);
