import type {
  LegacyPoint,
  LegacyStandardCandidate,
  LegacyStandardGenerationInput,
} from "./types";

const EPS = 0.5;
const deg2rad = (degrees: number) => (degrees * Math.PI) / 180;

function centroid(polygon: LegacyPoint[]) {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }
  const count = Math.max(1, polygon.length);
  return { x: x / count, y: y / count };
}

function subtract(a: LegacyPoint, b: LegacyPoint): LegacyPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: LegacyPoint, b: LegacyPoint): LegacyPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

function rotate(point: LegacyPoint, theta: number): LegacyPoint {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function worldToLocal(point: LegacyPoint, origin: LegacyPoint, theta: number): LegacyPoint {
  return rotate(subtract(point, origin), -theta);
}

function localToWorld(point: LegacyPoint, origin: LegacyPoint, theta: number): LegacyPoint {
  return add(rotate(point, theta), origin);
}

function pointInPolygonInclusive(point: LegacyPoint, polygon: LegacyPoint[]): boolean {
  const count = polygon.length;
  if (count < 3) return false;

  for (let index = 0, previous = count - 1; index < count; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    const cross =
      (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) < EPS) {
      const dot =
        (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
      if (dot >= -EPS) {
        const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (dot <= lengthSquared + EPS) return true;
      }
    }
  }

  let inside = false;
  for (let index = 0, previous = count - 1; index < count; previous = index++) {
    const xi = polygon[index].x;
    const yi = polygon[index].y;
    const xj = polygon[previous].x;
    const yj = polygon[previous].y;
    const intersects = yi > point.y !== yj > point.y;
    if (intersects) {
      const intersectionX = ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
      if (intersectionX >= point.x - EPS) inside = !inside;
    }
  }
  return inside;
}

function horizontalSegments(
  localPolygon: LegacyPoint[],
  y: number,
): Array<{ minX: number; maxX: number }> {
  const intersections: number[] = [];
  const count = localPolygon.length;
  for (let index = 0, previous = count - 1; index < count; previous = index++) {
    const a = localPolygon[previous];
    const b = localPolygon[index];
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (y < minY - 1e-6 || y > maxY + 1e-6) continue;
    if (Math.abs(a.y - b.y) < 1e-6) continue;
    const ratio = (y - a.y) / (b.y - a.y);
    intersections.push(a.x + ratio * (b.x - a.x));
  }

  intersections.sort((a, b) => a - b);
  const segments: Array<{ minX: number; maxX: number }> = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    segments.push({ minX: intersections[index], maxX: intersections[index + 1] });
  }
  return segments;
}

function normalizePhase(phase: number) {
  if (!isFinite(phase)) return 0;
  let normalized = phase % 1;
  if (normalized < 0) normalized += 1;
  return normalized;
}

export function computeLegacyStandardCandidates(
  input: LegacyStandardGenerationInput,
): LegacyStandardCandidate[] {
  const {
    roofPolygon,
    mppImage,
    canvasAngleDeg,
    orientation,
    panelSizeM,
    spacingM,
    spacingXM,
    spacingYM,
    marginM,
    phaseX = 0,
    anchorX = "start",
    coverageRatio = 1,
  } = input;

  // legacy-v1 intentionally ignores input.phaseY and input.anchorY.

  if (!roofPolygon.length || !mppImage) return [];

  const pixels = (meters: number) => meters / mppImage;
  const panelWidth = pixels(
    orientation === "portrait" ? panelSizeM.widthM : panelSizeM.heightM,
  );
  const panelHeight = pixels(
    orientation === "portrait" ? panelSizeM.heightM : panelSizeM.widthM,
  );
  const gapX = pixels(
    typeof spacingXM === "number" && Number.isFinite(spacingXM)
      ? spacingXM
      : spacingM,
  );
  const gapY = pixels(
    typeof spacingYM === "number" && Number.isFinite(spacingYM)
      ? spacingYM
      : spacingM,
  );
  const marginPx = Math.max(0, pixels(marginM));

  let theta: number;
  if (typeof canvasAngleDeg === "number") {
    theta = deg2rad(canvasAngleDeg);
  } else {
    type EdgeInfo = { length: number; angle: number };
    const edges: EdgeInfo[] = [];
    for (let index = 0; index < roofPolygon.length; index += 1) {
      const a = roofPolygon[index];
      const b = roofPolygon[(index + 1) % roofPolygon.length];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const length = Math.hypot(vx, vy);
      if (length < 2) continue;
      edges.push({ length, angle: Math.atan2(vy, vx) });
    }

    if (!edges.length) {
      theta = 0;
    } else {
      const longest = edges.reduce(
        (current, edge) => (edge.length > current.length ? edge : current),
        edges[0],
      );
      const axisTolerance = (10 * Math.PI) / 180;
      const axisCandidates = edges.filter((edge) => {
        const absoluteAngle = Math.abs(edge.angle);
        const angleFromVertical = Math.abs(Math.PI / 2 - absoluteAngle);
        const horizontal =
          absoluteAngle < axisTolerance ||
          Math.abs(Math.PI - absoluteAngle) < axisTolerance;
        const vertical = angleFromVertical < axisTolerance;
        return horizontal || vertical;
      });

      let chosen: EdgeInfo | null = null;
      if (axisCandidates.length) {
        const bestAxis = axisCandidates.reduce(
          (current, edge) => (edge.length > current.length ? edge : current),
          axisCandidates[0],
        );
        if (bestAxis.length >= longest.length * 0.75) chosen = bestAxis;
      }

      theta = (chosen ?? longest).angle;
      if (theta < 0) theta += Math.PI;
    }
  }

  const angleDeg = (theta * 180) / Math.PI;
  const origin = centroid(roofPolygon);
  const localPolygon = roofPolygon.map((point) => worldToLocal(point, origin, theta));

  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of localPolygon) {
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!isFinite(minY)) return [];

  const cellWidth = panelWidth + gapX;
  const cellHeight = panelHeight + gapY;
  const rowStarts: number[] = [];
  for (
    let y = minY + marginPx;
    y + panelHeight <= maxY - marginPx + 1e-6;
    y += cellHeight
  ) {
    rowStarts.push(y);
  }

  const maximumRows = rowStarts.length;
  const rowsToUse = Math.max(
    1,
    Math.min(
      maximumRows,
      Math.round(maximumRows * Math.max(0.01, Math.min(1, coverageRatio))),
    ),
  );
  const usedRows = rowStarts.slice(0, rowsToUse);
  const candidates: LegacyStandardCandidate[] = [];

  for (let rowIndex = 0; rowIndex < usedRows.length; rowIndex += 1) {
    const y = usedRows[rowIndex];
    const topSegments = horizontalSegments(localPolygon, y);
    const bottomSegments = horizontalSegments(localPolygon, y + panelHeight);
    if (!topSegments.length || !bottomSegments.length) continue;

    let bestSegment: { minX: number; maxX: number } | null = null;
    let bestLength = -1;
    for (const top of topSegments) {
      for (const bottom of bottomSegments) {
        const minX = Math.max(top.minX, bottom.minX);
        const maxX = Math.min(top.maxX, bottom.maxX);
        if (maxX - minX >= panelWidth - 1e-6) {
          const length = maxX - minX;
          if (length > bestLength) {
            bestLength = length;
            bestSegment = { minX, maxX };
          }
        }
      }
    }
    if (!bestSegment) continue;

    const segmentMinX = bestSegment.minX + marginPx;
    const segmentMaxX = bestSegment.maxX - marginPx;
    if (segmentMaxX - segmentMinX < panelWidth) continue;

    const spanX = segmentMaxX - segmentMinX;
    const maximumColumns = Math.max(
      0,
      Math.floor((spanX - panelWidth + 1e-6) / cellWidth) + 1,
    );
    const usedWidth =
      maximumColumns > 0
        ? maximumColumns * panelWidth + (maximumColumns - 1) * gapX
        : 0;
    const remainingX = Math.max(0, spanX - usedWidth);
    const anchorOffsetX =
      anchorX === "end" ? remainingX : anchorX === "center" ? remainingX / 2 : 0;
    const startX = segmentMinX + anchorOffsetX + normalizePhase(phaseX) * cellWidth;

    for (
      let x = startX;
      x + panelWidth <= segmentMaxX + 1e-6;
      x += cellWidth
    ) {
      const corners: LegacyPoint[] = [
        { x, y },
        { x: x + panelWidth, y },
        { x: x + panelWidth, y: y + panelHeight },
        { x, y: y + panelHeight },
      ];
      if (!corners.every((corner) => pointInPolygonInclusive(corner, localPolygon))) {
        continue;
      }

      const center = localToWorld(
        { x: x + panelWidth / 2, y: y + panelHeight / 2 },
        origin,
        theta,
      );
      candidates.push({
        cx: center.x,
        cy: center.y,
        wPx: panelWidth,
        hPx: panelHeight,
        angleDeg,
      });
    }
  }

  return candidates;
}
