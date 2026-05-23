export interface StreamBatchScheduler {
  schedule(callback: () => void): () => void;
}

export interface StreamBatchSchedulerRuntime {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  maxPaintWaitMs: number;
}

export function createFrameStreamBatchScheduler(
  runtime: StreamBatchSchedulerRuntime,
): StreamBatchScheduler {
  return {
    schedule(callback) {
      let settled = false;
      let frameId: number | null = null;
      let timerId: unknown = null;
      const run = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (frameId !== null) {
          runtime.cancelAnimationFrame?.(frameId);
        }
        if (timerId !== null) {
          runtime.clearTimeout(timerId);
        }
        callback();
      };

      if (runtime.requestAnimationFrame) {
        frameId = runtime.requestAnimationFrame(run);
        timerId = runtime.setTimeout(run, runtime.maxPaintWaitMs);
        return () => {
          settled = true;
          if (frameId !== null) {
            runtime.cancelAnimationFrame?.(frameId);
          }
          if (timerId !== null) {
            runtime.clearTimeout(timerId);
          }
        };
      }

      timerId = runtime.setTimeout(run, 0);
      return () => {
        settled = true;
        if (timerId !== null) {
          runtime.clearTimeout(timerId);
        }
      };
    },
  };
}
