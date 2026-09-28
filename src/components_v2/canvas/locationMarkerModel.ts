import type { Snapshot } from "@/types/planner";
import { lonLatToImagePx } from "../utils/geo";

export type AddressCoordinates = {
  lat: number | null;
  lon: number | null;
};

type LocationMarkerVisibility = {
  selectedRoofId?: string;
  explicitRoofSelectionVersion: number;
};

const MAX_WEB_MERCATOR_LATITUDE = 85.05112878;

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasUsableProjection(snapshot: Snapshot): boolean {
  if (
    !isFiniteCoordinate(snapshot.width) ||
    snapshot.width <= 0 ||
    !isFiniteCoordinate(snapshot.height) ||
    snapshot.height <= 0
  ) {
    return false;
  }

  const bbox = snapshot.bbox3857;
  if (
    bbox &&
    isFiniteCoordinate(bbox.minX) &&
    isFiniteCoordinate(bbox.minY) &&
    isFiniteCoordinate(bbox.maxX) &&
    isFiniteCoordinate(bbox.maxY) &&
    bbox.maxX > bbox.minX &&
    bbox.maxY > bbox.minY
  ) {
    return true;
  }

  return Boolean(
    snapshot.center &&
      isFiniteCoordinate(snapshot.center.lat) &&
      isFiniteCoordinate(snapshot.center.lon) &&
      isFiniteCoordinate(snapshot.mppImage) &&
      snapshot.mppImage > 0,
  );
}

/** Returns image-space pixels only when the address and snapshot are trustworthy. */
export function resolveLocationMarkerPoint(
  snapshot: Snapshot,
  address: AddressCoordinates,
) {
  if (
    !isFiniteCoordinate(address.lat) ||
    !isFiniteCoordinate(address.lon) ||
    address.lat < -MAX_WEB_MERCATOR_LATITUDE ||
    address.lat > MAX_WEB_MERCATOR_LATITUDE ||
    address.lon < -180 ||
    address.lon > 180 ||
    !hasUsableProjection(snapshot)
  ) {
    return null;
  }

  const point = lonLatToImagePx(snapshot, address.lon, address.lat);
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/** Auto-selection during Sonnendach import does not count as user intent. */
export function shouldShowLocationMarker({
  selectedRoofId,
  explicitRoofSelectionVersion,
}: LocationMarkerVisibility): boolean {
  return !selectedRoofId || explicitRoofSelectionVersion === 0;
}
