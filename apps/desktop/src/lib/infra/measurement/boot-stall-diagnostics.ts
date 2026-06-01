import { logRendererEvent } from "@/lib/access/tauri/diagnostics";
import {
  BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY,
  BOOT_DIAGNOSTICS_PARAM,
  BOOT_DIAGNOSTICS_STORAGE_KEY,
  MAX_BOOT_EVENTS,
  type BootDiagnosticApi,
  type BootDiagnosticDump,
  type BootDiagnosticEvent,
} from "./boot-stall-diagnostics-types";
import {
  currentRoute,
  isLikelyWebKitRuntime,
  isNoisyBootLabel,
  sanitizeBootMetadata,
  summarizeBootValue,
} from "./boot-stall-diagnostics-format";
import {
  getFetchDiagnosticTotals,
  getTopFetchSummaries,
  installBootDiagnosticsFetchProbe,
  resetBootDiagnosticsFetch,
  uninstallBootDiagnosticsFetchProbe,
} from "./boot-stall-diagnostics-fetch";
import {
  getBootPerformanceMeasureStats,
  installBootDiagnosticsPerformanceMeasureProbe,
  resetBootDiagnosticsPerformanceMeasures,
  uninstallBootDiagnosticsPerformanceMeasureProbe,
} from "./boot-stall-diagnostics-performance";
import {
  getBootDiagnosticsLayoutStats,
  installBootDiagnosticsFrameProbe,
  installBootDiagnosticsLayoutReadProbe,
  resetBootDiagnosticsLayoutReads,
  resetBootDiagnosticsLayoutTiming,
  uninstallBootDiagnosticsLayoutProbes,
} from "./boot-stall-diagnostics-layout";
import {
  ensureBootDiagnosticsOverlay,
  removeBootDiagnosticsOverlay,
  renderBootDiagnosticsOverlay,
} from "./boot-stall-diagnostics-overlay";
import {
  envFlagEnabled,
  getMeasurementMemorySnapshot,
  now,
  round,
} from "@/lib/infra/measurement/debug-measurement-utils";

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
let flushScheduled = false;
const events: BootDiagnosticEvent[] = [];
const recordedOnceLabels = new Set<string>();

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
  resetBootDiagnosticsLayoutTiming();

  ensureBootDiagnosticsOverlay({
    copy: () => {
      void copyBootDiagnosticsDump();
    },
    clear: clearBootDiagnostics,
  });
  installBootDiagnosticsGlobal();
  installBootDiagnosticsErrorListeners();
  installWebKitPerformanceMeasureDetailGuard();
  installBootDiagnosticsFetchProbe({
    recordBootDiagnostic,
    getNextSeq: () => nextSeq,
  });
  installBootDiagnosticsLayoutReadProbe(recordBootDiagnostic);
  installBootDiagnosticsFrameProbe({
    recordBootDiagnostic,
    flushBootDiagnostics,
  });
  recordBootDiagnostic("boot_diagnostics.installed", {
    userAgent: navigator.userAgent,
  });

  return uninstallBootStallDiagnostics;
}

export function installWebKitPerformanceMeasureDetailGuard(): void {
  if (!import.meta.env.DEV || typeof window === "undefined" || !isLikelyWebKitRuntime()) {
    return;
  }

  installBootDiagnosticsPerformanceMeasureProbe(recordBootDiagnostic);
}

export function uninstallBootStallDiagnostics(): void {
  installed = false;
  uninstallBootDiagnosticsLayoutProbes();
  uninstallBootDiagnosticsFetchProbe();
  uninstallBootDiagnosticsPerformanceMeasureProbe();

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

function scheduleBootDiagnosticsFlush(): void {
  if (flushScheduled || typeof window === "undefined") {
    return;
  }

  flushScheduled = true;
  window.setTimeout(flushBootDiagnostics, 0);
}

function flushBootDiagnostics(): void {
  flushScheduled = false;
  const fetchTotals = getFetchDiagnosticTotals();
  const performanceStats = getBootPerformanceMeasureStats();
  const layoutStats = getBootDiagnosticsLayoutStats();
  renderBootDiagnosticsOverlay({
    startedAtMs,
    lastFrameAtMs: layoutStats.lastFrameAtMs,
    maxFrameGapMs: layoutStats.maxFrameGapMs,
    eventCount: events.length,
    eventSeq: nextSeq - 1,
    events,
    route: currentRoute(),
    fetchStarts: fetchTotals.starts,
    fetchErrors: fetchTotals.errors,
    performanceDetailStripCount: performanceStats.detailStripped,
    layoutReadInAnimationFrameCount: layoutStats.inAnimationFrames,
    copy: () => {
      void copyBootDiagnosticsDump();
    },
    clear: clearBootDiagnostics,
  });
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

function clearBootDiagnostics(): void {
  events.splice(0);
  recordedOnceLabels.clear();
  resetBootDiagnosticsFetch();
  resetBootDiagnosticsPerformanceMeasures();
  resetBootDiagnosticsLayoutReads();
  nextSeq = 1;
  droppedEventCount = 0;
  try {
    window.localStorage.removeItem(BOOT_DIAGNOSTICS_STORAGE_KEY);
    window.localStorage.removeItem(BOOT_DIAGNOSTICS_EVENTS_STORAGE_KEY);
  } catch {
    // Local storage is optional for this diagnostic path.
  }
  enabledCache = false;
  removeBootDiagnosticsOverlay();
}

function getBootDiagnosticsDump(): BootDiagnosticDump {
  const fetchTotals = getFetchDiagnosticTotals();
  const performanceStats = getBootPerformanceMeasureStats();
  const layoutStats = getBootDiagnosticsLayoutStats();
  return {
    tag: "boot_stall_diagnostics",
    version: 3,
    createdAt: new Date().toISOString(),
    timestampMs: Date.now(),
    route: currentRoute(),
    eventSeq: nextSeq - 1,
    droppedEvents: droppedEventCount,
    maxFrameGapMs: round(layoutStats.maxFrameGapMs),
    memory: getMeasurementMemorySnapshot(),
    fetches: {
      ...fetchTotals,
      top: getTopFetchSummaries(),
    },
    performanceMeasures: performanceStats,
    layoutReads: {
      inAnimationFrames: layoutStats.inAnimationFrames,
      reported: layoutStats.reported,
      uniqueStacks: layoutStats.uniqueStacks,
      topStacks: layoutStats.topStacks,
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
