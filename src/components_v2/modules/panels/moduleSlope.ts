export function imageVectorFromGeographicAzimuth(azimuthDeg: number): {
  x: number;
  y: number;
} {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

/** Explicit flat-system directions override the panel-local fallback. */
export function resolveModuleSlopeArrowAzimuth(input: {
  panelRotationCanvasDeg: number;
  physicalArrowAzimuthDeg?: number;
  localArrowOffsetDeg?: number;
}): number | undefined {
  return resolvePanelLocalArrowAzimuth(
    input.physicalArrowAzimuthDeg ??
      input.panelRotationCanvasDeg + (input.localArrowOffsetDeg ?? 0),
  );
}

/**
 * The pitched-module arrow is fixed to local +Y. The Konva Arrow primitive
 * points toward local -Y at zero rotation, therefore +180° expresses +Y.
 */
export const PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG = 180;

export type BlockArrowMember = {
  id: string;
  blockKey?: string;
  cx: number;
  cy: number;
};

/**
 * Resolves the physical downhill direction for opposing module pairs.
 *
 * The result is deliberately derived from geometry rather than slot order or
 * the directed reference-edge tangent: each arrow points from the common
 * block centre towards its own module centre. Reversing an edge's endpoints
 * therefore cannot invert the physical East/West semantics.
 */
export function resolveOutwardBlockArrowAzimuths(
  members: readonly BlockArrowMember[],
): ReadonlyMap<string, number> {
  const byBlock = new Map<string, BlockArrowMember[]>();
  for (const member of members) {
    if (!member.blockKey) continue;
    const group = byBlock.get(member.blockKey);
    if (group) group.push(member);
    else byBlock.set(member.blockKey, [member]);
  }

  const result = new Map<string, number>();
  for (const group of byBlock.values()) {
    if (group.length < 2) continue;
    const center = group.reduce(
      (sum, member) => ({
        x: sum.x + member.cx / group.length,
        y: sum.y + member.cy / group.length,
      }),
      { x: 0, y: 0 },
    );
    for (const member of group) {
      const dx = member.cx - center.x;
      const dy = member.cy - center.y;
      if (Math.hypot(dx, dy) <= 1e-9) continue;
      // Canvas/image vector for geographic azimuth a is (sin(a), -cos(a)).
      result.set(member.id, normalizeAzimuth((Math.atan2(dx, -dy) * 180) / Math.PI));
    }
  }
  return result;
}

/**
 * Legacy flat-roof fallback: a panel is rendered around its centre with its
 * forward/top on local -Y, so its canvas rotation is also the arrow azimuth.
 * Schrägdach passes PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG so the arrow stays
 * rigidly attached to the panel through every layout rotation.
 */
export function resolvePanelLocalArrowAzimuth(panelRotationCanvasDeg: number): number | undefined {
  return Number.isFinite(panelRotationCanvasDeg)
    ? normalizeAzimuth(panelRotationCanvasDeg)
    : undefined;
}
