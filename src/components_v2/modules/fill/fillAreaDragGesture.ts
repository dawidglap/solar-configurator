import {
  createLatestFrameScheduler,
  type FrameScheduler,
} from "../../canvas/performance/latestFrameScheduler";

export type FillAreaDragPoint = { x: number; y: number };

export type FillAreaDragVisual = {
  start: FillAreaDragPoint;
  end: FillAreaDragPoint;
};

type FillAreaDragGestureOptions = {
  thresholdPx?: number;
  onVisual: (visual: FillAreaDragVisual | null) => void;
  onCommit: (visual: FillAreaDragVisual) => void;
  createScheduler?: (
    run: (point: FillAreaDragPoint) => void,
  ) => FrameScheduler<FillAreaDragPoint>;
};

type FillAreaDragSession = FillAreaDragVisual & {
  activated: boolean;
};

/**
 * Headless press-drag-release lifecycle for the transient fill selection.
 * Raw pointer bursts are coalesced; only release may trigger a commit.
 */
export function createFillAreaDragGesture(options: FillAreaDragGestureOptions) {
  const thresholdPx = options.thresholdPx ?? 5;
  let session: FillAreaDragSession | null = null;

  const processPoint = (point: FillAreaDragPoint) => {
    if (!session) return;
    session.end = point;
    const dx = point.x - session.start.x;
    const dy = point.y - session.start.y;
    if (!session.activated && dx * dx + dy * dy < thresholdPx * thresholdPx) {
      return;
    }
    session.activated = true;
    options.onVisual({ start: session.start, end: point });
  };

  const scheduler = (
    options.createScheduler ?? ((run) => createLatestFrameScheduler(run))
  )(processPoint);

  return {
    begin(start: FillAreaDragPoint) {
      scheduler.cancel();
      session = { start, end: start, activated: false };
      options.onVisual(null);
    },
    move(point: FillAreaDragPoint) {
      if (!session) return false;
      scheduler.schedule(point);
      return true;
    },
    end(point: FillAreaDragPoint) {
      if (!session) return false;
      scheduler.schedule(point);
      scheduler.flush();
      const completed = session;
      session = null;
      scheduler.cancel();
      if (completed.activated) {
        options.onCommit({ start: completed.start, end: completed.end });
      }
      options.onVisual(null);
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
