import { logRendererEvent } from "@/lib/access/tauri/diagnostics";
import {
  envFlagEnabled,
  getMeasurementMemorySnapshot,
  now,
  round,
} from "@/lib/infra/measurement/debug-measurement-utils";

const BOOT_DIAGNOSTICS_PARAM = "proliferateBootDiagnostics";
const BOOT_DIAGNOSTICS_STORAGE_KEY = "proliferate.bootDiagnostics";
const BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY = "proliferate.bootDiagnostics.events";
const BOOT_DIAGNOSTICS_OVERLAY_ID = "proliferate-boot-diagnostics";
const MAX_BOOT_EVENTS = 160;
const MAX_VISIBLE_EVENTS = 18;
const MAX_FETCH_SUMMARY_ENTRIES = 240;
const MAX_LAYOUT_READ_STACK_SUMMARIES = 80;
const MAX_PERFORMANCE_MEASURE_SUMMARIES = 80;
const MAX_PERFORMANCE_MEASURE_REPORTS = 30;
const FRAME_GAP_THRESHOLD_MS = 200;
const MAX_LAYOUT_READ_REPORTS = 40;
const MAX_LAYOUT_READ_STACK_CAPTURE_COUNT = 80;
const SLOW_LAYOUT_READ_THRESHOLD_MS = 12;
const LAYOUT_READ_TOTAL_MILESTONES = new Set([1, 5, 10, 25, 50, 100, 250, 500, 1_000]);
const INTERNAL_LOG_RENDERER_EVENT_URL = "ipc://localhost/log_renderer_event";
const NOISY_BOOT_LABEL_PREFIXES = ["app_runtime.render.", "fetch.", "performance.measure."];

interface BootDiagnosticEvent {
  seq: number;
  elapsedMs: number;
  timestampMs: number;
  label: string;
  route: string | null;
  metadata?: Record<string, unknown>;
}

interface BootDiagnosticDump {
  tag: "boot_stall_diagnostics";
  version: 3;
  createdAt: string;
  timestampMs: number;
  route: string | null;
  eventSeq: number;
  droppedEvents: number;
  maxFrameGapMs: number;
  memory: ReturnType<typeof getMeasurementMemorySnapshot>;
  fetches: {
    starts: number;
    ends: number;
    errors: number;
    inFlight: number;
    top: FetchDiagnosticSummary[];
  };
  performanceMeasures: {
    calls: number;
    detailStripped: number;
    top: PerformanceMeasureDiagnosticSummary[];
  };
  layoutReads: {
    inAnimationFrames: number;
    reported: number;
    uniqueStacks: number;
    topStacks: LayoutReadStackDiagnosticSummary[];
  };
  events: BootDiagnosticEvent[];
}

interface FetchDiagnosticSummary {
  key: string;
  method: string;
  url: string;
  starts: number;
  ends: number;
  errors: number;
  inFlight: number;
  lastStatus: number | null;
  lastDurationMs: number | null;
  maxDurationMs: number;
  lastError: unknown;
}

interface LayoutReadStackDiagnosticSummary {
  signature: string;
  count: number;
  reported: number;
  slow: number;
  lastDurationMs: number;
  maxDurationMs: number;
  lastElement: string | null;
  lastStack: string | null;
}

interface PerformanceMeasureDiagnosticSummary {
  name: string;
  calls: number;
  detailStripped: number;
  nativeSkipped: number;
  lastDetailSummary: unknown;
  lastStack: string | null;
}

interface PreparedPerformanceMeasureCall {
  args: unknown[];
  fallbackEntry: PerformanceMeasure | null;
  skipNative: boolean;
}

interface ActiveAnimationFrameDiagnostic {
  callbackName: string;
  id: number;
  scheduledAtMs: number;
  startedAtMs: number;
}

interface BootDiagnosticOverlay {
  root: HTMLElement;
  summary: HTMLElement;
  events: HTMLElement;
}

interface BootDiagnosticApi {
  dump: () => BootDiagnosticDump;
  clear: () => void;
}

declare global {
  interface Window {
    proliferateBootDiagnostics?: BootDiagnosticApi;
    __PROLIFERATE_BOOT_DIAGNOSTICS__?: BootDiagnosticApi;
  }
}

let installed = false;
let enabledCache: boolean | null = null;
let startedAtMs = now();
let nextSeq = 1;
let droppedEventCount = 0;
let animationFrameId: number | null = null;
let heartbeatIntervalId: number | null = null;
let lastFrameAtMs = now();
let maxFrameGapMs = 0;
let overlay: BootDiagnosticOverlay | null = null;
let originalFetch: typeof window.fetch | null = null;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame | null = null;
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect | null = null;
let originalPerformanceMeasure: Performance["measure"] | null = null;
let flushScheduled = false;
let nextAnimationFrameDiagnosticId = 1;
let activeAnimationFrame: ActiveAnimationFrameDiagnostic | null = null;
let layoutReadInAnimationFrameCount = 0;
let layoutReadReportCount = 0;
let performanceMeasureCallCount = 0;
let performanceMeasureDetailStripCount = 0;
const events: BootDiagnosticEvent[] = [];
const recordedOnceLabels = new Set<string>();
const layoutReadStackCounts = new Map<string, number>();
const layoutReadStackSummaries = new Map<string, LayoutReadStackDiagnosticSummary>();
const fetchSummaries = new Map<string, FetchDiagnosticSummary>();
const performanceMeasureSummaries = new Map<string, PerformanceMeasureDiagnosticSummary>();

export function installBootStallDiagnostics(): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return () => undefined;
  }

  applyBootDiagnosticsUrlFlag();
  if (installed || !isBootStallDiagnosticsEnabled()) {
    return () => undefined;
  }

  installed = true;
  startedAtMs = now();
  lastFrameAtMs = now();
  maxFrameGapMs = 0;

  ensureBootDiagnosticsOverlay();
  installBootDiagnosticsGlobal();
  installBootDiagnosticsErrorListeners();
  installWebKitPerformanceMeasureDetailGuard();
  installBootDiagnosticsFetchProbe();
  installBootDiagnosticsLayoutReadProbe();
  installBootDiagnosticsFrameProbe();
  recordBootDiagnostic("boot_diagnostics.installed", {
    userAgent: navigator.userAgent,
  });

  return uninstallBootStallDiagnostics;
}

export function installWebKitPerformanceMeasureDetailGuard(): void {
  if (!import.meta.env.DEV || typeof window === "undefined" || !isLikelyWebKitRuntime()) {
    return;
  }

  installBootDiagnosticsPerformanceMeasureProbe();
}

export function uninstallBootStallDiagnostics(): void {
  installed = false;

  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (heartbeatIntervalId !== null) {
    window.clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }

  if (originalFetch !== null) {
    window.fetch = originalFetch;
    originalFetch = null;
  }

  if (originalRequestAnimationFrame !== null) {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    originalRequestAnimationFrame = null;
  }

  if (originalGetBoundingClientRect !== null && typeof Element !== "undefined") {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    originalGetBoundingClientRect = null;
  }

  if (originalPerformanceMeasure !== null && typeof performance !== "undefined") {
    performance.measure = originalPerformanceMeasure;
    originalPerformanceMeasure = null;
  }

  if (window.proliferateBootDiagnostics?.dump === getBootDiagnosticsDump) {
    delete window.proliferateBootDiagnostics;
  }
  if (window.__PROLIFERATE_BOOT_DIAGNOSTICS__?.dump === getBootDiagnosticsDump) {
    delete window.__PROLIFERATE_BOOT_DIAGNOSTICS__;
  }
}

export function recordBootDiagnostic(
  label: string,
  metadata?: Record<string, unknown>,
): void {
  if (!isBootStallDiagnosticsEnabled()) {
    return;
  }

  const event: BootDiagnosticEvent = {
    seq: nextSeq,
    elapsedMs: round(now() - startedAtMs),
    timestampMs: Date.now(),
    label,
    route: currentRoute(),
    metadata: metadata === undefined ? undefined : sanitizeBootMetadata(metadata),
  };
  nextSeq += 1;

  events.push(event);
  if (events.length > MAX_BOOT_EVENTS) {
    droppedEventCount += events.length - MAX_BOOT_EVENTS;
    events.splice(0, events.length - MAX_BOOT_EVENTS);
  }

  scheduleBootDiagnosticsFlush();
  if (!isNoisyBootLabel(label)) {
    logBootDiagnosticToConsole(event);
    void logRendererEvent({
      source: "renderer_boot_diagnostics",
      message: label,
      route: event.route,
      elapsedMs: event.elapsedMs,
    }).catch(() => {
      // Boot diagnostics must stay best-effort and cannot affect startup.
    });
  }
}

export function recordBootDiagnosticOnce(
  label: string,
  metadata?: Record<string, unknown>,
): void {
  if (recordedOnceLabels.has(label)) {
    return;
  }
  recordedOnceLabels.add(label);
  recordBootDiagnostic(label, metadata);
}

export function isBootStallDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  if (enabledCache !== null) {
    return enabledCache;
  }

  enabledCache = envFlagEnabled(import.meta.env.VITE_PROLIFERATE_BOOT_DIAGNOSTICS, false)
    || readBootDiagnosticsBrowserFlag()
    || readBootDiagnosticsUrlFlag();
  return enabledCache;
}

export function isBootDiagnosticsBrowserFlagEnabled(): boolean {
  return readBootDiagnosticsBrowserFlag() || readBootDiagnosticsUrlFlag();
}

function isLikelyWebKitRuntime(): boolean {
  const userAgent = navigator.userAgent;
  return userAgent.includes("AppleWebKit")
    && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent);
}

function installBootDiagnosticsGlobal(): void {
  const api: BootDiagnosticApi = {
    dump: getBootDiagnosticsDump,
    clear: clearBootDiagnostics,
  };
  window.proliferateBootDiagnostics = api;
  window.__PROLIFERATE_BOOT_DIAGNOSTICS__ = api;
}

function installBootDiagnosticsErrorListeners(): void {
  window.addEventListener("error", (event) => {
    recordBootDiagnostic("window.error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordBootDiagnostic("window.unhandled_rejection", {
      reason: summarizeBootValue(event.reason),
    });
  });
}

function installBootDiagnosticsPerformanceMeasureProbe(): void {
  if (
    originalPerformanceMeasure !== null
    || typeof performance === "undefined"
    || typeof performance.measure !== "function"
  ) {
    return;
  }

  originalPerformanceMeasure = performance.measure;
  const measureWithDiagnostics = function bootDiagnosticsPerformanceMeasure(
    ...args: unknown[]
  ): PerformanceMeasure {
    performanceMeasureCallCount += 1;
    const preparedCall = preparePerformanceMeasureCall(args);
    if (preparedCall.skipNative && preparedCall.fallbackEntry) {
      return preparedCall.fallbackEntry;
    }
    return (originalPerformanceMeasure as (...measureArgs: unknown[]) => PerformanceMeasure)
      .apply(performance, preparedCall.args);
  } as Performance["measure"];

  try {
    performance.measure = measureWithDiagnostics;
  } catch (error) {
    originalPerformanceMeasure = null;
    recordBootDiagnostic("performance.measure_probe.install_failed", {
      error: summarizeBootValue(error),
    });
  }
}

function preparePerformanceMeasureCall(args: unknown[]): PreparedPerformanceMeasureCall {
  const name = typeof args[0] === "string" ? args[0] : "[unknown]";
  const options = args[1];
  if (!isPerformanceMeasureOptionsWithDetail(options)) {
    recordPerformanceMeasureSummary(name, {
      detailSummary: null,
      nativeSkipped: false,
      stack: null,
      strippedDetail: false,
    });
    return {
      args,
      fallbackEntry: null,
      skipNative: false,
    };
  }

  const stack = stackWithoutBootDiagnosticFrames(new Error().stack ?? "");
  const detailSummary = summarizePerformanceMeasureDetail(options.detail);
  const skipNative = isReactDevToolsPerformanceDetail(options.detail);
  performanceMeasureDetailStripCount += 1;
  recordPerformanceMeasureSummary(name, {
    detailSummary,
    nativeSkipped: skipNative,
    stack: stack || null,
    strippedDetail: true,
  });

  if (performanceMeasureDetailStripCount <= MAX_PERFORMANCE_MEASURE_REPORTS) {
    recordBootDiagnostic("performance.measure.detail_stripped", {
      name,
      detailSummary,
      nativeSkipped: skipNative,
      stack: stack || null,
    });
  }

  if (skipNative) {
    return {
      args,
      fallbackEntry: createSyntheticPerformanceMeasure(name, options, detailSummary),
      skipNative: true,
    };
  }

  const sanitizedOptions = {
    ...options,
    detail: detailSummary,
  };
  return {
    args: [args[0], sanitizedOptions, ...args.slice(2)],
    fallbackEntry: null,
    skipNative: false,
  };
}

function isPerformanceMeasureOptionsWithDetail(
  value: unknown,
): value is PerformanceMeasureOptions & { detail: unknown } {
  return typeof value === "object"
    && value !== null
    && "detail" in value
    && (value as PerformanceMeasureOptions).detail !== undefined
    && (value as PerformanceMeasureOptions).detail !== null;
}

function recordPerformanceMeasureSummary(
  name: string,
  {
    detailSummary,
    nativeSkipped,
    stack,
    strippedDetail,
  }: {
    detailSummary: unknown;
    nativeSkipped: boolean;
    stack: string | null;
    strippedDetail: boolean;
  },
): void {
  let summary = performanceMeasureSummaries.get(name);
  if (!summary) {
    if (performanceMeasureSummaries.size >= MAX_PERFORMANCE_MEASURE_SUMMARIES) {
      return;
    }
    summary = {
      name,
      calls: 0,
      detailStripped: 0,
      nativeSkipped: 0,
      lastDetailSummary: null,
      lastStack: null,
    };
    performanceMeasureSummaries.set(name, summary);
  }

  summary.calls += 1;
  if (strippedDetail) {
    summary.detailStripped += 1;
    if (nativeSkipped) {
      summary.nativeSkipped += 1;
    }
    summary.lastDetailSummary = detailSummary;
    summary.lastStack = stack;
  }
}

function isReactDevToolsPerformanceDetail(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "devtools" in value;
}

function createSyntheticPerformanceMeasure(
  name: string,
  options: PerformanceMeasureOptions,
  detail: unknown,
): PerformanceMeasure {
  const startTime = typeof options.start === "number" ? options.start : now();
  const endTime = typeof options.end === "number" ? options.end : startTime;
  const duration = typeof options.duration === "number"
    ? options.duration
    : Math.max(0, endTime - startTime);
  const entry = {
    detail,
    duration,
    entryType: "measure",
    name,
    startTime,
    toJSON() {
      return {
        detail,
        duration,
        entryType: "measure",
        name,
        startTime,
      };
    },
  };
  return entry as PerformanceMeasure;
}

function summarizePerformanceMeasureDetail(value: unknown): unknown {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: value.length > 160 ? `${value.slice(0, 160)}...` : value,
    };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
    };
  }

  if (typeof value === "object") {
    return {
      type: Object.prototype.toString.call(value),
      constructorName: value.constructor?.name ?? null,
    };
  }

  return {
    type: typeof value,
    value: String(value),
  };
}

function installBootDiagnosticsFetchProbe(): void {
  if (originalFetch !== null || typeof window.fetch !== "function") {
    return;
  }

  originalFetch = window.fetch;
  window.fetch = async function bootDiagnosticsFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const requestSeq = nextSeq;
    const startedAt = now();
    const request = summarizeFetchRequest(input, init);
    if (request.url === INTERNAL_LOG_RENDERER_EVENT_URL) {
      return originalFetch!.call(window, input, init);
    }

    recordFetchSummaryStart(request);
    recordBootDiagnostic("fetch.start", {
      requestSeq,
      ...request,
    });

    try {
      const response = await originalFetch!.call(window, input, init);
      const durationMs = round(now() - startedAt);
      recordFetchSummaryEnd(request, response.status, durationMs);
      recordBootDiagnostic("fetch.end", {
        requestSeq,
        ...request,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (error) {
      const durationMs = round(now() - startedAt);
      recordFetchSummaryError(request, error, durationMs);
      recordBootDiagnostic("fetch.error", {
        requestSeq,
        ...request,
        durationMs,
        error: summarizeBootValue(error),
      });
      throw error;
    }
  };
}

function recordFetchSummaryStart(request: Record<string, unknown>): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.starts += 1;
  summary.inFlight += 1;
}

function recordFetchSummaryEnd(
  request: Record<string, unknown>,
  status: number,
  durationMs: number,
): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.ends += 1;
  summary.inFlight = Math.max(0, summary.inFlight - 1);
  summary.lastStatus = status;
  summary.lastDurationMs = durationMs;
  summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
}

function recordFetchSummaryError(
  request: Record<string, unknown>,
  error: unknown,
  durationMs: number,
): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.errors += 1;
  summary.inFlight = Math.max(0, summary.inFlight - 1);
  summary.lastDurationMs = durationMs;
  summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
  summary.lastError = summarizeBootValue(error);
}

function getFetchSummary(request: Record<string, unknown>): FetchDiagnosticSummary | null {
  const method = typeof request.method === "string" ? request.method : "GET";
  const url = typeof request.url === "string" ? request.url : "[unknown-url]";
  const key = `${method} ${url}`;
  const existing = fetchSummaries.get(key);
  if (existing) {
    return existing;
  }

  if (fetchSummaries.size >= MAX_FETCH_SUMMARY_ENTRIES) {
    return null;
  }

  const summary: FetchDiagnosticSummary = {
    key,
    method,
    url,
    starts: 0,
    ends: 0,
    errors: 0,
    inFlight: 0,
    lastStatus: null,
    lastDurationMs: null,
    maxDurationMs: 0,
    lastError: null,
  };
  fetchSummaries.set(key, summary);
  return summary;
}

function installBootDiagnosticsLayoutReadProbe(): void {
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
    recordLayoutReadInAnimationFrame(this, activeFrame, now() - startedAt);
    return rect;
  };
}

function installBootDiagnosticsFrameProbe(): void {
  const tick = (frameAtMs: number) => {
    const frameGapMs = frameAtMs - lastFrameAtMs;
    lastFrameAtMs = frameAtMs;
    if (frameGapMs > FRAME_GAP_THRESHOLD_MS) {
      maxFrameGapMs = Math.max(maxFrameGapMs, frameGapMs);
      recordBootDiagnostic("main_thread.frame_gap", {
        frameGapMs: round(frameGapMs),
        maxFrameGapMs: round(maxFrameGapMs),
      });
    }
    animationFrameId = requestAnimationFrame(tick);
  };

  animationFrameId = requestAnimationFrame(tick);
  heartbeatIntervalId = window.setInterval(() => {
    flushBootDiagnostics();
  }, 1_000);
}

function recordLayoutReadInAnimationFrame(
  element: Element,
  frameDiagnostic: ActiveAnimationFrameDiagnostic,
  durationMs: number,
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

function stackWithoutBootDiagnosticFrames(stack: string): string {
  return stack
    .split("\n")
    .filter((line) =>
      !line.includes("recordLayoutReadInAnimationFrame")
      && !line.includes("bootDiagnosticsGetBoundingClientRect")
    )
    .slice(0, 9)
    .join("\n");
}

function scheduleBootDiagnosticsFlush(): void {
  if (flushScheduled || typeof window === "undefined") {
    return;
  }

  flushScheduled = true;
  window.setTimeout(flushBootDiagnostics, 0);
}

function flushBootDiagnostics(): void {
  flushScheduled = false;
  renderBootDiagnosticsOverlay();
  persistBootDiagnosticsEvents();
}

function applyBootDiagnosticsUrlFlag(): void {
  const flag = readBootDiagnosticsUrlParam();
  if (flag === null) {
    return;
  }

  if (["clear", "0", "false", "off", "no"].includes(flag)) {
    try {
      window.localStorage.removeItem(BOOT_DIAGNOSTICS_STORAGE_KEY);
      window.localStorage.removeItem(BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY);
    } catch {
      // Local storage may be unavailable in privacy-restricted browser contexts.
    }
    enabledCache = false;
    return;
  }

  if (["persist", "save"].includes(flag)) {
    try {
      window.localStorage.setItem(BOOT_DIAGNOSTICS_STORAGE_KEY, "1");
    } catch {
      // Local storage is optional for this diagnostic path.
    }
  }
  enabledCache = null;
}

function readBootDiagnosticsUrlFlag(): boolean {
  const flag = readBootDiagnosticsUrlParam();
  return flag !== null && envFlagEnabled(flag, true);
}

function readBootDiagnosticsUrlParam(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get(BOOT_DIAGNOSTICS_PARAM);
    return value?.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function readBootDiagnosticsBrowserFlag(): boolean {
  try {
    return envFlagEnabled(
      window.localStorage.getItem(BOOT_DIAGNOSTICS_STORAGE_KEY) ?? undefined,
      false,
    );
  } catch {
    return false;
  }
}

function ensureBootDiagnosticsOverlay(): BootDiagnosticOverlay | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (overlay) {
    return overlay;
  }

  const existingRoot = document.getElementById(BOOT_DIAGNOSTICS_OVERLAY_ID);
  const root = existingRoot ?? document.createElement("aside");
  root.id = BOOT_DIAGNOSTICS_OVERLAY_ID;
  root.style.cssText = [
    "position:fixed",
    "right:10px",
    "bottom:10px",
    "z-index:2147483647",
    "box-sizing:border-box",
    "width:min(620px,calc(100vw - 20px))",
    "max-height:min(520px,65vh)",
    "overflow:hidden",
    "border:1px solid rgba(255,255,255,.22)",
    "border-radius:8px",
    "background:rgba(11,11,13,.94)",
    "box-shadow:0 18px 50px rgba(0,0,0,.35)",
    "color:#f4f4f5",
    "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
    "letter-spacing:0",
    "pointer-events:auto",
  ].join(";");

  root.innerHTML = [
    "<div data-role=\"header\" style=\"display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);font-weight:700;\">",
    "<span style=\"flex:1;\">Boot diagnostics</span>",
    "<button data-action=\"copy\" style=\"border:1px solid rgba(255,255,255,.18);border-radius:5px;background:rgba(255,255,255,.08);color:inherit;padding:2px 7px;font:inherit;\">Copy</button>",
    "<button data-action=\"clear\" style=\"border:1px solid rgba(255,255,255,.18);border-radius:5px;background:rgba(255,255,255,.08);color:inherit;padding:2px 7px;font:inherit;\">Clear</button>",
    "</div>",
    "<div data-role=\"summary\" style=\"padding:7px 10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,.1);\"></div>",
    "<ol data-role=\"events\" style=\"list-style:none;margin:0;padding:6px 10px 9px;overflow:auto;max-height:410px;\"></ol>",
  ].join("");

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "copy") {
      void copyBootDiagnosticsDump();
    }
    if (action === "clear") {
      clearBootDiagnostics();
    }
  });

  if (!existingRoot) {
    const attach = () => document.body.appendChild(root);
    if (document.body) {
      attach();
    } else {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
  }

  overlay = {
    root,
    summary: root.querySelector<HTMLElement>("[data-role='summary']")!,
    events: root.querySelector<HTMLElement>("[data-role='events']")!,
  };
  return overlay;
}

function renderBootDiagnosticsOverlay(): void {
  const currentOverlay = ensureBootDiagnosticsOverlay();
  if (!currentOverlay) {
    return;
  }

  const elapsedMs = round(now() - startedAtMs);
  const sinceLastFrameMs = round(now() - lastFrameAtMs);
  const memory = getMeasurementMemorySnapshot();
  const fetchTotals = getFetchDiagnosticTotals();
  currentOverlay.summary.textContent = [
    `elapsed ${elapsedMs}ms`,
    `events ${events.length}/${nextSeq - 1}`,
    `max gap ${round(maxFrameGapMs)}ms`,
    `last frame ${sinceLastFrameMs}ms ago`,
    `fetch ${fetchTotals.starts}/${fetchTotals.errors}err`,
    `measure ${performanceMeasureDetailStripCount} stripped`,
    `layout ${layoutReadInAnimationFrameCount}`,
    memory.usedJSHeapSize === null
      ? "heap n/a"
      : `heap ${formatBytes(memory.usedJSHeapSize)}`,
    currentRoute() ?? "",
  ].filter(Boolean).join(" | ");

  const visibleEvents = events.slice(-MAX_VISIBLE_EVENTS).reverse();
  currentOverlay.events.textContent = "";
  for (const event of visibleEvents) {
    const item = document.createElement("li");
    item.style.cssText = [
      "display:grid",
      "grid-template-columns:58px minmax(0,1fr)",
      "gap:8px",
      "padding:2px 0",
      "border-bottom:1px solid rgba(255,255,255,.04)",
    ].join(";");

    const time = document.createElement("span");
    time.style.color = "#a1a1aa";
    time.textContent = `${event.elapsedMs}ms`;

    const body = document.createElement("span");
    body.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    body.title = JSON.stringify(event);
    body.textContent = formatEventLine(event);

    item.append(time, body);
    currentOverlay.events.appendChild(item);
  }
}

function clearBootDiagnostics(): void {
  events.splice(0);
  recordedOnceLabels.clear();
  layoutReadStackCounts.clear();
  layoutReadStackSummaries.clear();
  fetchSummaries.clear();
  performanceMeasureSummaries.clear();
  nextSeq = 1;
  droppedEventCount = 0;
  layoutReadInAnimationFrameCount = 0;
  layoutReadReportCount = 0;
  performanceMeasureCallCount = 0;
  performanceMeasureDetailStripCount = 0;
  maxFrameGapMs = 0;
  try {
    window.localStorage.removeItem(BOOT_DIAGNOSTICS_STORAGE_KEY);
    window.localStorage.removeItem(BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY);
  } catch {
    // Local storage is optional for this diagnostic path.
  }
  enabledCache = false;
  overlay?.root.remove();
  overlay = null;
}

function getFetchDiagnosticTotals(): Pick<
  BootDiagnosticDump["fetches"],
  "starts" | "ends" | "errors" | "inFlight"
> {
  let starts = 0;
  let ends = 0;
  let errors = 0;
  let inFlight = 0;
  for (const summary of fetchSummaries.values()) {
    starts += summary.starts;
    ends += summary.ends;
    errors += summary.errors;
    inFlight += summary.inFlight;
  }
  return { starts, ends, errors, inFlight };
}

function getTopFetchSummaries(): FetchDiagnosticSummary[] {
  return Array.from(fetchSummaries.values())
    .sort((left, right) =>
      (right.starts + right.errors * 4 + right.inFlight * 2 + right.maxDurationMs / 100)
      - (left.starts + left.errors * 4 + left.inFlight * 2 + left.maxDurationMs / 100)
    )
    .slice(0, 20)
    .map((summary) => ({ ...summary }));
}

function getTopLayoutReadStackSummaries(): LayoutReadStackDiagnosticSummary[] {
  return Array.from(layoutReadStackSummaries.values())
    .sort((left, right) =>
      (right.count + right.slow * 4 + right.maxDurationMs / 10)
      - (left.count + left.slow * 4 + left.maxDurationMs / 10)
    )
    .slice(0, 20)
    .map((summary) => ({ ...summary }));
}

function getTopPerformanceMeasureSummaries(): PerformanceMeasureDiagnosticSummary[] {
  return Array.from(performanceMeasureSummaries.values())
    .sort((left, right) =>
      (right.detailStripped * 8 + right.nativeSkipped * 4 + right.calls)
      - (left.detailStripped * 8 + left.nativeSkipped * 4 + left.calls)
    )
    .slice(0, 20)
    .map((summary) => ({ ...summary }));
}

function getBootDiagnosticsDump(): BootDiagnosticDump {
  const fetchTotals = getFetchDiagnosticTotals();
  return {
    tag: "boot_stall_diagnostics",
    version: 3,
    createdAt: new Date().toISOString(),
    timestampMs: Date.now(),
    route: currentRoute(),
    eventSeq: nextSeq - 1,
    droppedEvents: droppedEventCount,
    maxFrameGapMs: round(maxFrameGapMs),
    memory: getMeasurementMemorySnapshot(),
    fetches: {
      ...fetchTotals,
      top: getTopFetchSummaries(),
    },
    performanceMeasures: {
      calls: performanceMeasureCallCount,
      detailStripped: performanceMeasureDetailStripCount,
      top: getTopPerformanceMeasureSummaries(),
    },
    layoutReads: {
      inAnimationFrames: layoutReadInAnimationFrameCount,
      reported: layoutReadReportCount,
      uniqueStacks: layoutReadStackCounts.size,
      topStacks: getTopLayoutReadStackSummaries(),
    },
    events: [...events],
  };
}

async function copyBootDiagnosticsDump(): Promise<void> {
  const body = JSON.stringify(getBootDiagnosticsDump(), null, 2);
  try {
    await navigator.clipboard.writeText(body);
    recordBootDiagnostic("boot_diagnostics.copy.completed");
  } catch {
    console.info("[boot-diagnostics-json]", body);
    recordBootDiagnostic("boot_diagnostics.copy.failed");
  }
}

function persistBootDiagnosticsEvents(): void {
  try {
    window.localStorage.setItem(
      BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY,
      JSON.stringify(getBootDiagnosticsDump()),
    );
  } catch {
    // Ignore quota or availability errors. The visible overlay is the primary path.
  }
}

function logBootDiagnosticToConsole(event: BootDiagnosticEvent): void {
  if (event.metadata) {
    console.info(`[boot-diagnostics] ${event.label}`, event.metadata);
    return;
  }
  console.info(`[boot-diagnostics] ${event.label}`);
}

function isNoisyBootLabel(label: string): boolean {
  return NOISY_BOOT_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

function summarizeFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, unknown> {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return {
    method,
    url: sanitizeBootUrl(input instanceof Request ? input.url : String(input)),
  };
}

function sanitizeBootUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

function describeBootElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 5)
    .map((className) => `.${className}`)
    .join("");
  const dataAttributes = [
    "data-chat-transcript-root",
    "data-chat-composer-footer",
    "data-chat-composer-surface",
    "data-code",
    "data-file",
    "data-file-source-virtualized",
    "data-index",
    "data-transcript-virtual-row",
  ]
    .flatMap((name) => {
      const value = element.getAttribute(name);
      return value === null ? [] : [`[${name}=${JSON.stringify(value)}]`];
    })
    .join("");
  return `${tagName}${id}${classes}${dataAttributes}`.slice(0, 500);
}

function sanitizeBootMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 12)) {
    sanitized[key] = summarizeBootValue(item);
  }
  return sanitized;
}

function summarizeBootValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.slice(0, 1_000) ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(summarizeBootValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 10)
        .map(([key, item]) => [key, summarizeBootValue(item)]),
    );
  }

  return String(value);
}

function formatEventLine(event: BootDiagnosticEvent): string {
  if (!event.metadata || Object.keys(event.metadata).length === 0) {
    return event.label;
  }

  return `${event.label} ${JSON.stringify(event.metadata)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${round(value / 1024)} KB`;
  }
  return `${round(value / (1024 * 1024))} MB`;
}

function currentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
