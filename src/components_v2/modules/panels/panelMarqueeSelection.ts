import { createLatestFrameScheduler, type FrameScheduler } from "../../canvas/performance/latestFrameScheduler";

export type ScreenPoint = { x: number; y: number };

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MarqueePanelCandidate = {
  id: string;
  polygon: ScreenPoint[];
  /** Current canonical editing unit; D-Dome candidates contain both slot IDs. */
  selectionIds: string[];
};

export type MarqueeSelectionVisual = {
  bounds: ScreenRect;
  selectedIds: string[];
  polygons: ScreenPoint[][];
};

type MarqueeSession = {
  start: ScreenPoint;
  additive: boolean;
  initialIds: string[];
  candidates: MarqueePanelCandidate[];
  activated: boolean;
  currentIds: string[];
};

type MarqueeControllerOptions = {
  thresholdPx?: number;
  onVisual: (visual: MarqueeSelectionVisual | null) => void;
  onCommit: (ids: string[]) => void;
  onEmptyClick: () => void;
  createScheduler?: (run: (point: ScreenPoint) => void) => FrameScheduler<ScreenPoint>;
};

export function normalizeScreenRect(a: ScreenPoint, b: ScreenPoint): ScreenRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x, b.x) - x,
    height: Math.max(a.y, b.y) - y,
  };
}

function pointInRect(point: ScreenPoint, rect: ScreenRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}

function pointInPolygon(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: ScreenPoint, b: ScreenPoint, point: ScreenPoint): boolean {
  const epsilon = 1e-7;
  return Math.abs(orientation(a, b, point)) <= epsilon &&
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon;
}

function segmentsIntersect(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  d: ScreenPoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) ||
    onSegment(c, d, a) || onSegment(c, d, b);
}

/** Exact polygon/rectangle intersection; touching an edge is a meaningful hit. */
export function polygonIntersectsScreenRect(
  polygon: readonly ScreenPoint[],
  rect: ScreenRect,
): boolean {
  if (polygon.length < 3) return false;
  if (polygon.some((point) => pointInRect(point, rect))) return true;

  const rectCorners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  if (rectCorners.some((point) => pointInPolygon(point, polygon))) return true;

  for (let p = 0; p < polygon.length; p += 1) {
    const polygonA = polygon[p];
    const polygonB = polygon[(p + 1) % polygon.length];
    for (let r = 0; r < rectCorners.length; r += 1) {
      if (segmentsIntersect(
        polygonA,
        polygonB,
        rectCorners[r],
        rectCorners[(r + 1) % rectCorners.length],
      )) return true;
    }
  }
  return false;
}

export function resolveMarqueeSelection(args: {
  bounds: ScreenRect;
  candidates: readonly MarqueePanelCandidate[];
  initialIds: readonly string[];
  additive: boolean;
}): { selectedIds: string[]; polygons: ScreenPoint[][] } {
  const candidateIds = new Set(args.candidates.map((candidate) => candidate.id));
  const selected = new Set(
    args.additive ? args.initialIds.filter((id) => candidateIds.has(id)) : [],
  );
  for (const candidate of args.candidates) {
    if (!polygonIntersectsScreenRect(candidate.polygon, args.bounds)) continue;
    candidate.selectionIds.forEach((id) => {
      if (candidateIds.has(id)) selected.add(id);
    });
  }
  const selectedIds = args.candidates
    .map((candidate) => candidate.id)
    .filter((id) => selected.has(id));
  const selectedSet = new Set(selectedIds);
  return {
    selectedIds,
    polygons: args.candidates
      .filter((candidate) => selectedSet.has(candidate.id))
      .map((candidate) => candidate.polygon),
  };
}

/** Headless gesture controller: raw moves are coalesced and selection commits once. */
export function createPanelMarqueeController(options: MarqueeControllerOptions) {
  const thresholdPx = options.thresholdPx ?? 5;
  let session: MarqueeSession | null = null;

  const processPoint = (point: ScreenPoint) => {
    if (!session) return;
    const dx = point.x - session.start.x;
    const dy = point.y - session.start.y;
    if (!session.activated && dx * dx + dy * dy < thresholdPx * thresholdPx) return;
    session.activated = true;
    const bounds = normalizeScreenRect(session.start, point);
    const resolved = resolveMarqueeSelection({
      bounds,
      candidates: session.candidates,
      initialIds: session.initialIds,
      additive: session.additive,
    });
    session.currentIds = resolved.selectedIds;
    options.onVisual({ bounds, selectedIds: resolved.selectedIds, polygons: resolved.polygons });
  };

  const scheduler = (options.createScheduler ?? ((run) => createLatestFrameScheduler(run)))(processPoint);

  return {
    begin(input: {
      start: ScreenPoint;
      additive: boolean;
      initialIds: string[];
      candidates: MarqueePanelCandidate[];
    }) {
      scheduler.cancel();
      session = { ...input, activated: false, currentIds: input.initialIds };
      options.onVisual(null);
    },
    move(point: ScreenPoint) {
      if (!session) return false;
      scheduler.schedule(point);
      return true;
    },
    end(point: ScreenPoint) {
      if (!session) return false;
      scheduler.schedule(point);
      scheduler.flush();
      const completed = session;
      session = null;
      scheduler.cancel();
      options.onVisual(null);
      if (completed.activated) options.onCommit(completed.currentIds);
      else options.onEmptyClick();
      return true;
    },
    cancel() {
      if (!session) return false;
      session = null;
      scheduler.cancel();
      options.onVisual(null);
      return true;
    },
    isActive() {
      return Boolean(session);
    },
  };
}
