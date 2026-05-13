import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { isMainThreadMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import { setLongTaskObserverSupportedForMeasurement } from "@/lib/infra/measurement/debug-measurement-observer";
import { recordJankIncident } from "@/lib/infra/measurement/debug-jank-activity";
import { isLatencyDebugLoggingEnabled, logLatency } from "@/lib/infra/measurement/debug-latency";
import type { JankIncidentCanarySnapshot } from "./debug-measurement-report-types";

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
    const previousFrameAtMs = previous;
    previous = timestamp;
    if (gap > FRAME_GAP_THRESHOLD_MS) {
      recordMeasurementMetric({
        type: "main_thread",
        surface: "workspace-shell",
        metric: "frame_gap",
        durationMs: gap,
        startedAtMs: previousFrameAtMs,
        endedAtMs: timestamp,
      });
      const incident = recordJankIncident({
        previousFrameAtMs,
        frameAtMs: timestamp,
        frameGapMs: gap,
        visibleCanaries: getVisibleJankCanaries(),
      });
      if (isLatencyDebugLoggingEnabled()) {
        logLatency("jank.frame_gap", {
          frameGapMs: incident.frameGapMs,
          activeOperationIds: incident.activeOperationIds,
          activeOperationKinds: incident.activeOperationKinds,
          visibleCanaries: incident.visibleCanaries,
          likelyCauses: incident.likelyCauses,
          overlappingActivities: incident.overlappingActivities.map((activity) => ({
            kind: activity.kind,
            label: activity.label,
            durationMs: activity.durationMs,
          })),
          precedingActivities: incident.precedingActivities.map((activity) => ({
            kind: activity.kind,
            label: activity.label,
            durationMs: activity.durationMs,
          })),
        });
      }
    }
    frameHandle = requestAnimationFrame(tick);
  };
  frameHandle = requestAnimationFrame(tick);
}

function getVisibleJankCanaries(): JankIncidentCanarySnapshot[] {
  if (typeof document === "undefined") {
    return [];
  }
  const counts = new Map<string, number>();
  const nodes = document.querySelectorAll<HTMLElement>("[data-jank-canary]");
  for (const node of nodes) {
    if (!isElementVisible(node)) {
      continue;
    }
    const kind = node.dataset.jankCanary || "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function isElementVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden"
    && style.display !== "none"
    && style.opacity !== "0";
}
