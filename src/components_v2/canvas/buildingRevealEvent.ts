import type { SonnendachRevealRoof } from "@/lib/planning/viewport/buildingReveal";

export const BUILDING_REVEAL_REQUEST_EVENT = "sola:building-reveal-request";

export type BuildingRevealRequest = {
  requestId: string;
  roofs: SonnendachRevealRoof[];
};

export function dispatchBuildingRevealRequest(request: BuildingRevealRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BuildingRevealRequest>(BUILDING_REVEAL_REQUEST_EVENT, {
      detail: request,
    }),
  );
}
