import { deriveSnowProtectionSummaryFromPlanning } from "./snowProtectionSummary";
import { isSnowProtectionCatalogItem } from "../snowProtectionCatalog";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Reconciles an Angebot parts list with the canonical Schneefang quantity.
 * The catalog remains authoritative for price/unit while planner geometry and
 * manual modal rows remain authoritative for quantity.
 */
export function mergeCanonicalSnowProtectionCommercialItem(
  persistedItems: readonly any[],
  catalogDocs: readonly any[],
  planning: unknown,
) {
  const snowCatalogItem = catalogDocs.find(isSnowProtectionCatalogItem);
  if (!snowCatalogItem) return [...persistedItems];

  const catalogItemId = String(snowCatalogItem._id ?? snowCatalogItem.id ?? "");
  const withoutCanonicalSnow = persistedItems.filter((item) => {
    const itemId = safeString(item?.id);
    const sourceId = safeString(
      item?.sourceCatalogItemId ?? item?.catalogItemId ?? item?.catalogId,
    );
    return itemId !== "auto-snow-protection" && sourceId !== catalogItemId;
  });
  const totalLengthM = deriveSnowProtectionSummaryFromPlanning(
    planning,
  ).totalLengthM;
  if (!(totalLengthM > 0)) return withoutCanonicalSnow;

  return [
    ...withoutCanonicalSnow,
    {
      id: "auto-snow-protection",
      kategorie: "Montage",
      marke: safeString(snowCatalogItem.brand),
      beschreibung: safeString(snowCatalogItem.name) || "Schneefang",
      einzelpreis: Number(safeNumber(snowCatalogItem.priceNet, 0).toFixed(2)),
      stk: Number(totalLengthM.toFixed(2)),
      einheit: safeString(snowCatalogItem.unitLabel) || "m",
      optional: false,
      sourceCatalogItemId: catalogItemId,
      sourceCategory: safeString(snowCatalogItem.category) || "mounting",
    },
  ];
}
