import {
  isMainThreadMeasurementEnabled,
  recordMeasurementMetric,
  setLongTaskObserverSupportedForMeasurement,
} from "@/lib/infra/measurement/debug-measurement";

const FRAME_GAP_THRESHOLD_MS = 50;

let installed = false;
let frameHandle: number | null = null;
let longTaskObserver: PerformanceObserver | null = null;

export function installDebugMainThreadDetectors(): () => void {
  if (installed || !isMainThreadMeasurementEnabled()) {
    return () => undefined;
  }
  installed = true;
  installLongTaskObserver();
  installFrameGapDetector();
  return uninstallDebugMainThreadDetectors;
}

export function uninstallDebugMainThreadDetectors(): void {
  installed = false;
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  if (longTaskObserver) {
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }
}

function installLongTaskObserver(): void {
  if (
    typeof PerformanceObserver === "undefined"
    || !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    setLongTaskObserverSupportedForMeasurement(false);
    return;
  }

  setLongTaskObserverSupportedForMeasurement(true);
  longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      recordMeasurementMetric({
        type: "main_thread",
        surface: "workspace-shell",
        metric: "long_task",
        durationMs: entry.duration,
      });
    }
  });
  longTaskObserver.observe({ entryTypes: ["longtask"] });
}

function installFrameGapDetector(): void {
  let previous = performance.now();
  const tick = (timestamp: number) => {
    const gap = timestamp - previous;
    previous = timestamp;
    if (gap > FRAME_GAP_THRESHOLD_MS) {
      recordMeasurementMetric({
        type: "main_thread",
        surface: "workspace-shell",
        metric: "frame_gap",
        durationMs: gap,
      });
    }
    frameHandle = requestAnimationFrame(tick);
  };
  frameHandle = requestAnimationFrame(tick);
}
