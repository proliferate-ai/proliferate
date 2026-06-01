import {
  FRAME_GAP_THRESHOLD_MS,
  LAYOUT_READ_TOTAL_MILESTONES,
  MAX_LAYOUT_READ_REPORTS,
  MAX_LAYOUT_READ_STACK_CAPTURE_COUNT,
  MAX_LAYOUT_READ_STACK_SUMMARIES,
  SLOW_LAYOUT_READ_THRESHOLD_MS,
  type ActiveAnimationFrameDiagnostic,
  type BootDiagnosticRecorder,
  type LayoutReadStackDiagnosticSummary,
} from "./boot-stall-diagnostics-types";
import {
  describeBootElement,
  stackWithoutBootDiagnosticFrames,
} from "./boot-stall-diagnostics-format";
import { now, round } from "./debug-measurement-utils";

let animationFrameId: number | null = null;
let heartbeatIntervalId: number | null = null;
let lastFrameAtMs = now();
let maxFrameGapMs = 0;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame | null = null;
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect | null = null;
let nextAnimationFrameDiagnosticId = 1;
let activeAnimationFrame: ActiveAnimationFrameDiagnostic | null = null;
let layoutReadInAnimationFrameCount = 0;
let layoutReadReportCount = 0;
const layoutReadStackCounts = new Map<string, number>();
const layoutReadStackSummaries = new Map<string, LayoutReadStackDiagnosticSummary>();

export function resetBootDiagnosticsLayoutTiming(): void {
  lastFrameAtMs = now();
  maxFrameGapMs = 0;
}

export function installBootDiagnosticsLayoutReadProbe(
  recordBootDiagnostic: BootDiagnosticRecorder,
): void {
  if (
    originalRequestAnimationFrame !== null
    || originalGetBoundingClientRect !== null
    || typeof window.requestAnimationFrame !== "function"
    || typeof Element === "undefined"
  ) {
    return;
  }

  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  window.requestAnimationFrame = function bootDiagnosticsRequestAnimationFrame(
    callback: FrameRequestCallback,
  ): number {
    const frameDiagnostic: ActiveAnimationFrameDiagnostic = {
      callbackName: callback.name || "[anonymous]",
      id: nextAnimationFrameDiagnosticId,
      scheduledAtMs: now(),
      startedAtMs: 0,
    };
    nextAnimationFrameDiagnosticId += 1;

    return originalRequestAnimationFrame!.call(window, (timestamp) => {
      const previousFrame = activeAnimationFrame;
      frameDiagnostic.startedAtMs = now();
      activeAnimationFrame = frameDiagnostic;
      try {
        callback(timestamp);
      } finally {
        activeAnimationFrame = previousFrame;
      }
    });
  };

  Element.prototype.getBoundingClientRect = function bootDiagnosticsGetBoundingClientRect(
    this: Element,
  ): DOMRect {
    const activeFrame = activeAnimationFrame;
    if (!activeFrame) {
      return originalGetBoundingClientRect!.call(this);
    }

    const startedAt = now();
    const rect = originalGetBoundingClientRect!.call(this);
    recordLayoutReadInAnimationFrame(this, activeFrame, now() - startedAt, recordBootDiagnostic);
    return rect;
  };
}

export function installBootDiagnosticsFrameProbe(input: {
  recordBootDiagnostic: BootDiagnosticRecorder;
  flushBootDiagnostics: () => void;
}): void {
  const tick = (frameAtMs: number) => {
    const frameGapMs = frameAtMs - lastFrameAtMs;
    lastFrameAtMs = frameAtMs;
    if (frameGapMs > FRAME_GAP_THRESHOLD_MS) {
      maxFrameGapMs = Math.max(maxFrameGapMs, frameGapMs);
      input.recordBootDiagnostic("main_thread.frame_gap", {
        frameGapMs: round(frameGapMs),
        maxFrameGapMs: round(maxFrameGapMs),
      });
    }
    animationFrameId = requestAnimationFrame(tick);
  };

  animationFrameId = requestAnimationFrame(tick);
  heartbeatIntervalId = window.setInterval(() => {
    input.flushBootDiagnostics();
  }, 1_000);
}

export function uninstallBootDiagnosticsLayoutProbes(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (heartbeatIntervalId !== null) {
    window.clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }

  if (originalRequestAnimationFrame !== null) {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    originalRequestAnimationFrame = null;
  }

  if (originalGetBoundingClientRect !== null && typeof Element !== "undefined") {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    originalGetBoundingClientRect = null;
  }
}

export function resetBootDiagnosticsLayoutReads(): void {
  layoutReadStackCounts.clear();
  layoutReadStackSummaries.clear();
  nextAnimationFrameDiagnosticId = 1;
  activeAnimationFrame = null;
  layoutReadInAnimationFrameCount = 0;
  layoutReadReportCount = 0;
  resetBootDiagnosticsLayoutTiming();
}

export function getBootDiagnosticsLayoutStats(): {
  inAnimationFrames: number;
  reported: number;
  uniqueStacks: number;
  topStacks: LayoutReadStackDiagnosticSummary[];
  lastFrameAtMs: number;
  maxFrameGapMs: number;
} {
  return {
    inAnimationFrames: layoutReadInAnimationFrameCount,
    reported: layoutReadReportCount,
    uniqueStacks: layoutReadStackCounts.size,
    topStacks: Array.from(layoutReadStackSummaries.values())
      .sort((left, right) =>
        (right.count + right.slow * 4 + right.maxDurationMs / 10)
        - (left.count + left.slow * 4 + left.maxDurationMs / 10)
      )
      .slice(0, 20)
      .map((summary) => ({ ...summary })),
    lastFrameAtMs,
    maxFrameGapMs,
  };
}

function recordLayoutReadInAnimationFrame(
  element: Element,
  frameDiagnostic: ActiveAnimationFrameDiagnostic,
  durationMs: number,
  recordBootDiagnostic: BootDiagnosticRecorder,
): void {
  layoutReadInAnimationFrameCount += 1;
  if (layoutReadReportCount >= MAX_LAYOUT_READ_REPORTS) {
    return;
  }

  const shouldCaptureStack =
    layoutReadInAnimationFrameCount <= MAX_LAYOUT_READ_STACK_CAPTURE_COUNT
    || durationMs >= SLOW_LAYOUT_READ_THRESHOLD_MS;
  const stack = shouldCaptureStack ? new Error().stack ?? "" : "";
  const displayStack = stack ? stackWithoutBootDiagnosticFrames(stack) : null;
  const signature = displayStack ? layoutReadStackSignature(displayStack) : "[stack-not-captured]";
  const stackCount = (layoutReadStackCounts.get(signature) ?? 0) + 1;
  layoutReadStackCounts.set(signature, stackCount);
  const stackSummary = getLayoutReadStackSummary(signature, displayStack);
  if (stackSummary) {
    const roundedDurationMs = round(durationMs);
    stackSummary.count += 1;
    stackSummary.lastDurationMs = roundedDurationMs;
    stackSummary.maxDurationMs = Math.max(stackSummary.maxDurationMs, roundedDurationMs);
    stackSummary.lastElement = describeBootElement(element);
    if (displayStack) {
      stackSummary.lastStack = displayStack;
    }
    if (durationMs >= SLOW_LAYOUT_READ_THRESHOLD_MS) {
      stackSummary.slow += 1;
    }
  }

  if (
    !LAYOUT_READ_TOTAL_MILESTONES.has(layoutReadInAnimationFrameCount)
    && stackCount !== 1
    && durationMs < SLOW_LAYOUT_READ_THRESHOLD_MS
  ) {
    return;
  }

  layoutReadReportCount += 1;
  if (stackSummary) {
    stackSummary.reported += 1;
  }
  recordBootDiagnostic("layout_read.in_animation_frame", {
    callbackName: frameDiagnostic.callbackName,
    durationMs: round(durationMs),
    element: describeBootElement(element),
    frameAgeMs: round(now() - frameDiagnostic.startedAtMs),
    frameId: frameDiagnostic.id,
    stack: displayStack,
    stackCount,
    totalCount: layoutReadInAnimationFrameCount,
    waitMs: round(frameDiagnostic.startedAtMs - frameDiagnostic.scheduledAtMs),
  });
}

function getLayoutReadStackSummary(
  signature: string,
  stack: string | null,
): LayoutReadStackDiagnosticSummary | null {
  const existing = layoutReadStackSummaries.get(signature);
  if (existing) {
    return existing;
  }

  if (layoutReadStackSummaries.size >= MAX_LAYOUT_READ_STACK_SUMMARIES) {
    return null;
  }

  const summary: LayoutReadStackDiagnosticSummary = {
    signature,
    count: 0,
    reported: 0,
    slow: 0,
    lastDurationMs: 0,
    maxDurationMs: 0,
    lastElement: null,
    lastStack: stack,
  };
  layoutReadStackSummaries.set(signature, summary);
  return summary;
}

function layoutReadStackSignature(stack: string): string {
  return stack
    .split("\n")
    .slice(0, 4)
    .join("\n");
}
