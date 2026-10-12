import type { Pt } from '@/types/planner';
import { buildRoofAnnotationModel, type RoofAnnotationKind } from './roofAnnotationModel';

const OUTWARD_OFFSET_PX = 72;
const INWARD_FALLBACK_PX = 48;
const VIEWPORT_PADDING_X_PX = 44;
const VIEWPORT_PADDING_Y_PX = 18;

type Size = { width: number; height: number };

export type RoofHudPosition = {
  left: number;
  top: number;
  placement: 'outside' | 'inside-fallback' | 'clamped-outside';
};

function rotatePoint(point: Pt, center: Pt, angleDeg: number): Pt {
  const angle = angleDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function fitsViewport(point: Pt, viewport: Size): boolean {
  return point.x >= VIEWPORT_PADDING_X_PX &&
    point.x <= viewport.width - VIEWPORT_PADDING_X_PX &&
    point.y >= VIEWPORT_PADDING_Y_PX &&
    point.y <= viewport.height - VIEWPORT_PADDING_Y_PX;
}

function clampToViewport(point: Pt, viewport: Size): Pt {
  return {
    x: Math.max(VIEWPORT_PADDING_X_PX, Math.min(viewport.width - VIEWPORT_PADDING_X_PX, point.x)),
    y: Math.max(VIEWPORT_PADDING_Y_PX, Math.min(viewport.height - VIEWPORT_PADDING_Y_PX, point.y)),
  };
}

export function resolveRoofHudPosition(input: {
  points: readonly Pt[];
  roofKind: RoofAnnotationKind;
  referenceEdgeIndex?: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  canvasRotationDeg: number;
  imageSize: Size;
  viewportSize: Size;
}): RoofHudPosition | undefined {
  if (
    input.points.length < 3 ||
    !(input.scale > 0) ||
    !(input.imageSize.width > 0) ||
    !(input.imageSize.height > 0) ||
    !(input.viewportSize.width > 0) ||
    !(input.viewportSize.height > 0)
  ) return undefined;
  const referenceEdge = buildRoofAnnotationModel({
    points: input.points,
    mppImage: 1,
    roofKind: input.roofKind,
    referenceEdgeIndex: input.referenceEdgeIndex,
  }).edges.find((edge) => edge.isReference);
  if (!referenceEdge) return undefined;

  const imageCenter = {
    x: input.imageSize.width / 2,
    y: input.imageSize.height / 2,
  };
  const midpoint = rotatePoint(referenceEdge.midpoint, imageCenter, input.canvasRotationDeg);
  const rotatedOutward = rotatePoint(
    {
      x: imageCenter.x + referenceEdge.outward.x,
      y: imageCenter.y + referenceEdge.outward.y,
    },
    imageCenter,
    input.canvasRotationDeg,
  );
  const outwardScreen = {
    x: rotatedOutward.x - imageCenter.x,
    y: rotatedOutward.y - imageCenter.y,
  };
  const edgeScreen = {
    x: input.offsetX + midpoint.x * input.scale,
    y: input.offsetY + midpoint.y * input.scale,
  };
  const outside = {
    x: edgeScreen.x + outwardScreen.x * OUTWARD_OFFSET_PX,
    y: edgeScreen.y + outwardScreen.y * OUTWARD_OFFSET_PX,
  };
  if (fitsViewport(outside, input.viewportSize)) {
    return { left: outside.x, top: outside.y, placement: 'outside' };
  }

  const inside = {
    x: edgeScreen.x - outwardScreen.x * INWARD_FALLBACK_PX,
    y: edgeScreen.y - outwardScreen.y * INWARD_FALLBACK_PX,
  };
  if (fitsViewport(inside, input.viewportSize)) {
    return { left: inside.x, top: inside.y, placement: 'inside-fallback' };
  }

  const clamped = clampToViewport(outside, input.viewportSize);
  return { left: clamped.x, top: clamped.y, placement: 'clamped-outside' };
}
