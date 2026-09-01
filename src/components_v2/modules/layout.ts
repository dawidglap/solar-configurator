import {
  computeLegacyStandardCandidates,
  type LegacyGridAnchor,
  type LegacyPoint,
  type LegacyStandardCandidate,
} from "@/lib/planning-core/legacy-standard";

export type Pt = LegacyPoint;
export type AutoRect = LegacyStandardCandidate;

/**
 * Compatibility adapter for existing planner imports.
 * The canonical legacy-v1 formulas live in src/lib/planning-core.
 */
export function computeAutoLayoutRects(args: {
  polygon: Pt[];
  mppImage: number;
  azimuthDeg?: number;
  orientation: "portrait" | "landscape";
  panelSizeM: { w: number; h: number };
  spacingM: number;
  spacingXM?: number;
  spacingYM?: number;
  marginM: number;
  phaseX?: number;
  phaseY?: number;
  anchorX?: LegacyGridAnchor;
  anchorY?: LegacyGridAnchor;
  coverageRatio?: number;
}): AutoRect[] {
  return computeLegacyStandardCandidates({
    roofPolygon: args.polygon,
    mppImage: args.mppImage,
    canvasAngleDeg: args.azimuthDeg,
    orientation: args.orientation,
    panelSizeM: {
      widthM: args.panelSizeM.w,
      heightM: args.panelSizeM.h,
    },
    spacingM: args.spacingM,
    spacingXM: args.spacingXM,
    spacingYM: args.spacingYM,
    marginM: args.marginM,
    phaseX: args.phaseX,
    phaseY: args.phaseY,
    anchorX: args.anchorX,
    anchorY: args.anchorY,
    coverageRatio: args.coverageRatio,
  });
}
