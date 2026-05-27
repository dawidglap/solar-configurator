"use client";

import { useEffect } from "react";
import { PANEL_CATALOG } from "@/constants/panels";
import { normalizeApiUrl } from "@/lib/planner-api";
import { catalogItemToPanelSpec } from "@/lib/catalogPanels";
import { usePlannerV2Store } from "./plannerV2Store";

type CatalogItemsResponse = {
  ok?: boolean;
  items?: any[];
};

export function useCatalogPanels() {
  const setCatalogPanels = usePlannerV2Store((s) => s.setCatalogPanels);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          normalizeApiUrl("/catalog-items?activeOnly=true&category=module"),
          {
            credentials: "include",
            cache: "no-store",
          }
        );

        const data = (await res.json().catch(() => null)) as CatalogItemsResponse | null;

        if (!res.ok || data?.ok === false || !Array.isArray(data?.items)) {
          throw new Error(
            typeof data === "object" && data && "error" in data
              ? String((data as any).error)
              : `HTTP ${res.status}`
          );
        }

        const panels = data.items
          .map(catalogItemToPanelSpec)
          .filter((panel): panel is NonNullable<typeof panel> => panel !== null)
          .sort((a, b) => {
            const brandCompare = a.brand.localeCompare(b.brand, undefined, {
              sensitivity: "base",
            });
            if (brandCompare !== 0) return brandCompare;
            return a.model.localeCompare(b.model, undefined, {
              sensitivity: "base",
            });
          });

        if (panels.length === 0) {
          console.warn(
            "[catalogPanels] empty module catalog from /api/catalog-items, fallback to PANEL_CATALOG"
          );
          if (!cancelled) setCatalogPanels(PANEL_CATALOG);
          return;
        }

        if (!cancelled) setCatalogPanels(panels);
      } catch (error) {
        console.warn(
          "[catalogPanels] failed loading /api/catalog-items, fallback to PANEL_CATALOG",
          error
        );
        if (!cancelled) setCatalogPanels(PANEL_CATALOG);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [setCatalogPanels]);
}
