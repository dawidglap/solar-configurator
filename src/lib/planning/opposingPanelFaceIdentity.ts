import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../planning-core/advanced";
import type { PanelInstance, RoofArea } from "@/types/planner";

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

function isOpposingPanel(panel: PanelInstance): boolean {
  return panel.advanced?.systemId === K2_D_DOME_SYSTEM_ID ||
    panel.advanced?.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
}

function configuredFaceAzimuth(
  panel: PanelInstance,
  roofsById: ReadonlyMap<string, RoofArea>,
): number | undefined {
  const slotIndex = panel.advanced?.slotIndex;
  if (slotIndex !== 0 && slotIndex !== 1) return undefined;
  const planning = resolveSurfacePlanning(roofsById.get(panel.roofId)?.surfacePlanning);
  if (planning.status !== "supported-advanced") return undefined;
  const system = planning.config.advanced.system;
  if (
    system.systemId !== K2_D_DOME_SYSTEM_ID &&
    system.systemId !== GENERIC_EAST_WEST_SYSTEM_ID
  ) return undefined;
  return normalizeAzimuth(system.primaryFaceAzimuthDeg + slotIndex * 180);
}

/**
 * Backfills only missing physical face identity on opposing Advanced modules.
 * Existing face metadata is authoritative and is never rewritten.
 */
export function stabilizeOpposingPanelFaceIdentities(
  panels: readonly PanelInstance[],
  roofs: readonly RoofArea[] = [],
): PanelInstance[] {
  const facesById = new Map<string, number>();
  const completeBlocks = new Map<string, PanelInstance[]>();
  const missingByBlock = new Map<string, PanelInstance[]>();
  for (const panel of panels) {
    if (!isOpposingPanel(panel) || !panel.advanced?.blockKey) continue;
    const key = `${panel.roofId}\u0000${panel.advanced.blockKey}`;
    completeBlocks.set(key, [...(completeBlocks.get(key) ?? []), panel]);
    if (!Number.isFinite(panel.advanced.moduleFaceAzimuthDeg)) {
      missingByBlock.set(key, [...(missingByBlock.get(key) ?? []), panel]);
    }
  }

  // Recover the exact currently rendered direction while both physical faces
  // are still available. This happens before a delete can orphan either slot.
  for (const [key, missingMembers] of missingByBlock) {
    const completeBlock = completeBlocks.get(key) ?? [];
    if (completeBlock.length !== 2) continue;
    const center = {
      x: (completeBlock[0].cx + completeBlock[1].cx) / 2,
      y: (completeBlock[0].cy + completeBlock[1].cy) / 2,
    };
    for (const panel of missingMembers) {
      const dx = panel.cx - center.x;
      const dy = panel.cy - center.y;
      if (Math.hypot(dx, dy) <= 1e-9) continue;
      facesById.set(panel.id, normalizeAzimuth((Math.atan2(dx, -dy) * 180) / Math.PI));
    }
  }

  // Already-orphaned legacy panels no longer have enough pair geometry.
  // Their persisted block slot and roof system configuration are deterministic.
  const roofsById = new Map(roofs.map((roof) => [roof.id, roof]));
  for (const panel of panels) {
    if (!isOpposingPanel(panel) || Number.isFinite(panel.advanced?.moduleFaceAzimuthDeg)) continue;
    if (facesById.has(panel.id)) continue;
    const faceAzimuthDeg = configuredFaceAzimuth(panel, roofsById);
    if (faceAzimuthDeg !== undefined) facesById.set(panel.id, faceAzimuthDeg);
  }

  if (!facesById.size) return [...panels];
  return panels.map((panel) => {
    const moduleFaceAzimuthDeg = facesById.get(panel.id);
    if (moduleFaceAzimuthDeg === undefined || !panel.advanced) return panel;
    return {
      ...panel,
      advanced: { ...panel.advanced, moduleFaceAzimuthDeg },
    };
  });
}
