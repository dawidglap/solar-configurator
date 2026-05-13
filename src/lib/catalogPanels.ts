import type { PanelSpec } from "@/types/planner";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function catalogItemToPanelSpec(item: any): PanelSpec | null {
  const id = safeString(item?.id);
  const name = safeString(item?.name);
  const brand = safeString(item?.brand);
  const model = safeString(item?.model) || name;
  const priceChf = safeNumber(item?.priceNet);
  const wp = safeNumber(item?.metadata?.powerWp);
  const widthM = safeNumber(item?.metadata?.widthM);
  const heightM = safeNumber(item?.metadata?.heightM);

  if (!id || !model || wp <= 0 || widthM <= 0 || heightM <= 0) {
    console.warn("[catalogPanels] skip invalid module", {
      id,
      name,
      brand,
      model,
      wp,
      widthM,
      heightM,
    });
    return null;
  }

  return {
    id,
    brand,
    model,
    priceChf,
    wp,
    widthM,
    heightM,
  };
}
