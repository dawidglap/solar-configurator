export type FrameScheduler<T> = {
  schedule(value: T): void;
  flush(): void;
  cancel(): void;
  hasPending(): boolean;
};

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export function createLatestFrameScheduler<T>(
  run: (value: T) => void,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
  cancelFrame: CancelFrame = cancelAnimationFrame,
): FrameScheduler<T> {
  let handle: number | null = null;
  let latest: T | undefined;

  const execute = () => {
    handle = null;
    if (latest === undefined) return;
    const value = latest;
    latest = undefined;
    run(value);
  };

  return {
    schedule(value) {
      latest = value;
      if (handle === null) handle = scheduleFrame(execute);
    },
    flush() {
      if (handle !== null) cancelFrame(handle);
      execute();
    },
    cancel() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      latest = undefined;
    },
    hasPending() {
      return handle !== null;
    },
  };
}
